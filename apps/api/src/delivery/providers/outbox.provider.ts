import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ChannelProvider, OutgoingMessage } from '../delivery.types.js';

/**
 * Development provider: nothing leaves the machine. Each message becomes a text file (plus an .html
 * preview for email) under STORAGE_DIR/outbox/<date>/, so one-time codes and links can be read there.
 */
export class OutboxProvider implements ChannelProvider {
  readonly name = 'outbox';
  private readonly dir: string;

  constructor(storageDir: string) {
    this.dir = resolve(storageDir, 'outbox');
  }

  async send(m: OutgoingMessage): Promise<{ providerMessageId: string }> {
    const now = new Date();
    const day = join(this.dir, now.toISOString().slice(0, 10));
    await mkdir(day, { recursive: true });
    const base = `${now.toISOString().slice(11, 19).replace(/:/g, '')}-${m.channel}-${m.id}`;
    const text = [`Channel: ${m.channel}`, `To: ${m.to}`, `Subject: ${m.subject}`, `Date: ${now.toISOString()}`, '', m.text, ''].join('\n');
    await writeFile(join(day, `${base}.txt`), text, 'utf8');
    if (m.channel === 'email' && m.html) await writeFile(join(day, `${base}.html`), m.html, 'utf8');
    return { providerMessageId: base };
  }
}
