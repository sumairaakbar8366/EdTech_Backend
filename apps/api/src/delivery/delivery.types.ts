import type { DeliveryChannel } from '../generated/prisma/client.js';

export type { DeliveryChannel };

/** What a template produces. SMS / WhatsApp / push use `text` only. */
export interface RenderedMessage {
  subject: string;
  text: string;
  html?: string;
  /** Where a push notification opens. */
  url?: string;
}

/** A message ready for a provider. */
export interface OutgoingMessage extends RenderedMessage {
  /** outbound_messages.id */
  id: string;
  channel: DeliveryChannel;
  /** Email address, E.164 phone number, or push subscription id. */
  to: string;
  schoolId?: string | null;
}

export interface ChannelProvider {
  /** Recorded on outbound_messages.provider. */
  readonly name: string;
  send(message: OutgoingMessage): Promise<{ providerMessageId?: string }>;
}

/** A permanent error (bad address, rejected by the provider): no retry. */
export class PermanentDeliveryError extends Error {}
