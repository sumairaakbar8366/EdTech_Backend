import { PermanentDeliveryError, type ChannelProvider, type OutgoingMessage } from '../delivery.types.js';

/**
 * SMS through Twilio's Messages API (works for Pakistani numbers). A 4xx answer (bad number,
 * unverified sender, blocked) is permanent; 429 and 5xx are retried by the queue.
 */
export class TwilioSmsProvider implements ChannelProvider {
  readonly name = 'twilio';

  constructor(private readonly opts: { accountSid: string; authToken: string; from: string }) {}

  async send(m: OutgoingMessage): Promise<{ providerMessageId?: string }> {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.opts.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: m.to, From: this.opts.from, Body: smsText(m) }),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (res.ok) return { providerMessageId: body.sid };
    const error = `Twilio ${res.status}${body.code ? ` (${body.code})` : ''}: ${body.message ?? 'request failed'}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentDeliveryError(error);
    throw new Error(error);
  }
}

/** SMS text: the subject as a heading, kept within two SMS parts where possible. */
export function smsText(m: Pick<OutgoingMessage, 'subject' | 'text'>): string {
  const text = m.text.startsWith(m.subject) ? m.text : `${m.subject}\n${m.text}`;
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}
