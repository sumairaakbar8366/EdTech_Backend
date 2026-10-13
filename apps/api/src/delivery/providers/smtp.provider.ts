import { createTransport, type Transporter } from 'nodemailer';
import { PermanentDeliveryError, type ChannelProvider, type OutgoingMessage } from '../delivery.types.js';

/** Email over SMTP: works with any mail service (Google Workspace, Brevo, Amazon SES, Mailgun …). */
export class SmtpProvider implements ChannelProvider {
  readonly name = 'smtp';
  private readonly transport: Transporter;

  constructor(
    opts: { host: string; port: number; secure: boolean; user?: string; pass?: string },
    private readonly from: string,
  ) {
    this.transport = createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.pass ?? '' } : undefined,
      pool: true,
      maxConnections: 3,
    });
  }

  async send(m: OutgoingMessage): Promise<{ providerMessageId?: string }> {
    try {
      const info = await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
      return { providerMessageId: info.messageId };
    } catch (e) {
      const code = (e as { responseCode?: number }).responseCode;
      // 5xx = the server refused the message for good (bad mailbox, policy): retrying will not help.
      if (code && code >= 500 && code < 600) throw new PermanentDeliveryError((e as Error).message);
      throw e;
    }
  }
}
