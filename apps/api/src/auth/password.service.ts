import { Injectable, OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

/** Argon2id hashing (OWASP-recommended). */
@Injectable()
export class PasswordService implements OnModuleInit {
  /** Verified against when an account does not exist, so response time does not reveal it. */
  private dummyHash: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-password-for-timing-equalization');
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      const ok = await argon2.verify(hash ?? this.dummyHash, password);
      return ok && hash != null;
    } catch {
      return false;
    }
  }
}
