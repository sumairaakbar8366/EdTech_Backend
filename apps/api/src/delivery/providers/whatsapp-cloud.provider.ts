import { PermanentDeliveryError, type ChannelProvider, type OutgoingMessage } from '../delivery.types.js';
import { smsText } from './twilio-sms.provider.js';

/**
 * WhatsApp through Meta's WhatsApp Business Cloud API. Messages a business starts must use an
 * approved template; with WHATSAPP_TEMPLATE set, the text goes into its single {{1}} body
 * parameter (e.g. a template "school_notification": "{{1}}"). Without a template, plain text is
 * sent, which WhatsApp only delivers inside a 24-hour customer-service window.
 */
export class WhatsAppCloudProvider implements ChannelProvider {
  readonly name = 'whatsapp-cloud';

  constructor(private readonly opts: { token: string; phoneNumberId: string; template?: string; language: string; apiVersion?: string }) {}

  async send(m: OutgoingMessage): Promise<{ providerMessageId?: string }> {
    const to = m.to.replace(/^\+/, '');
    const text = smsText(m);
    const payload = this.opts.template
      ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: this.opts.template, language: { code: this.opts.language }, components: [{ type: 'body', parameters: [{ type: 'text', text }] }] } }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: text } };
    const res = await fetch(`https://graph.facebook.com/${this.opts.apiVersion ?? 'v21.0'}/${encodeURIComponent(this.opts.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (res.ok) return { providerMessageId: body.messages?.[0]?.id };
    const error = `WhatsApp ${res.status}${body.error?.code ? ` (${body.error.code})` : ''}: ${body.error?.message ?? 'request failed'}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentDeliveryError(error);
    throw new Error(error);
  }
}
