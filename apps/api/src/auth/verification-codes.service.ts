import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DeliveryService, normaliseRecipient } from '../delivery/delivery.service.js';
import { RedisService } from '../redis/redis.service.js';

const TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
/** One code per address per minute, at most 6 an hour. */
const COOLDOWN_SECONDS = 60;
const HOURLY_LIMIT = 6;
/** Owner sign-in codes: the password was already checked, so signing out and in again must not make the owner wait. */
const OWNER_COOLDOWN_SECONDS = 5;
const OWNER_HOURLY_LIMIT = 30;

export type CodePurpose = 'verify' | 'change' | 'signup' | 'access' | 'owner';
/** Where a phone code goes. */
export type PhoneCodeChannel = 'whatsapp' | 'sms';

interface Pending {
  /** Who may redeem the code, e.g. "user:<school>:<user>" or "grant:<school>:<admin>". */
  owner: string;
  email: string;
  hash: string;
  attempts: number;
}

const hashOf = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex');

/**
 * Email one-time codes (OTP). A code proves the person can read the mailbox: it is emailed, kept
 * only as a hash in Redis for 10 minutes, allows 5 guesses, and can be redeemed only by the same
 * owner (the signed-in user, or the admin who asked for it) that requested it.
 */
@Injectable()
export class VerificationCodesService {
  constructor(
    private readonly redis: RedisService,
    private readonly delivery: DeliveryService,
  ) {}

  async send(opts: { owner: string; email: string; purpose: CodePurpose; schoolId?: string | null; schoolName?: string }) {
    const email = normaliseRecipient('email', opts.email);
    if (!(await this.redis.set(`otp:cool:${email}`, '1', 'EX', opts.purpose === 'owner' ? OWNER_COOLDOWN_SECONDS : COOLDOWN_SECONDS, 'NX'))) {
      throw new HttpException('A code was just sent to this address. Wait a minute before asking for another.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const hourKey = `otp:hour:${email}`;
    const sent = await this.redis.incr(hourKey);
    if (sent === 1) await this.redis.expire(hourKey, 3600);
    if (sent > (opts.purpose === 'owner' ? OWNER_HOURLY_LIMIT : HOURLY_LIMIT)) throw new HttpException('Too many codes were sent to this address. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);

    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pending: Pending = { owner: opts.owner, email, hash: hashOf(id, code), attempts: 0 };
    await this.redis.set(`otp:${id}`, JSON.stringify(pending), 'EX', TTL_SECONDS);
    await this.delivery.send({ channel: 'email', to: email, template: 'email_code', data: { code, purpose: opts.purpose, minutes: TTL_SECONDS / 60, schoolName: opts.schoolName }, schoolId: opts.schoolId ?? null });
    return { verificationId: id, email, expiresInSeconds: TTL_SECONDS, resendInSeconds: COOLDOWN_SECONDS };
  }

  /**
   * A code to a phone (WhatsApp, or SMS as the fallback). Same rules as the email code: 10 minutes,
   * 5 guesses, one use, and one a minute per number. Returns the number in international form.
   */
  async sendPhone(opts: { owner: string; phone: string; channel: PhoneCodeChannel; purpose: CodePurpose }) {
    const phone = normaliseRecipient(opts.channel, opts.phone);
    if (!(await this.redis.set(`otp:cool:${phone}`, '1', 'EX', COOLDOWN_SECONDS, 'NX'))) {
      throw new HttpException('A code was just sent to this number. Wait a minute before asking for another.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const hourKey = `otp:hour:${phone}`;
    const sent = await this.redis.incr(hourKey);
    if (sent === 1) await this.redis.expire(hourKey, 3600);
    if (sent > HOURLY_LIMIT) throw new HttpException('Too many codes were sent to this number. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);

    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // The destination is kept in the same field the email codes use.
    const pending: Pending = { owner: opts.owner, email: phone, hash: hashOf(id, code), attempts: 0 };
    await this.redis.set(`otp:${id}`, JSON.stringify(pending), 'EX', TTL_SECONDS);
    await this.delivery.send({ channel: opts.channel, to: phone, template: 'phone_code', data: { code, purpose: opts.purpose, minutes: TTL_SECONDS / 60 } });
    return { verificationId: id, phone, channel: opts.channel, expiresInSeconds: TTL_SECONDS, resendInSeconds: COOLDOWN_SECONDS };
  }

  /** Checks the code and returns the verified (lower-cased) email. Each code works once. */
  async verify(id: string, owner: string, code: string): Promise<string> {
    const key = `otp:${id}`;
    const raw = await this.redis.get(key);
    const pending = raw ? (JSON.parse(raw) as Pending) : null;
    if (!pending || pending.owner !== owner) throw new BadRequestException('This code has expired. Ask for a new one.');
    const given = Buffer.from(hashOf(id, code.trim()), 'hex');
    if (!timingSafeEqual(given, Buffer.from(pending.hash, 'hex'))) {
      pending.attempts += 1;
      if (pending.attempts >= MAX_ATTEMPTS) {
        await this.redis.del(key);
        throw new BadRequestException('Too many wrong codes. Ask for a new one.');
      }
      await this.redis.set(key, JSON.stringify(pending), 'KEEPTTL');
      throw new BadRequestException(`The code is not correct (${MAX_ATTEMPTS - pending.attempts} tries left).`);
    }
    // GETDEL-style: whoever deletes the key first redeems it.
    if ((await this.redis.del(key)) === 0) throw new BadRequestException('This code has already been used.');
    return pending.email;
  }
}
