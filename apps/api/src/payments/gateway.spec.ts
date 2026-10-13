import { describe, expect, it } from 'vitest';
import { smsText } from '../delivery/providers/twilio-sms.provider.js';
import { hmac, verifyHmac } from './gateway.js';
import { SandboxGateway, SANDBOX_SIGNATURE_HEADER } from './sandbox.gateway.js';
import type { WebUrls } from '../delivery/web-urls.service.js';

const urls = { site: (p: string) => `http://localhost:5173${p}` } as unknown as WebUrls;

describe('webhook signatures', () => {
  it('accepts the exact signed body and refuses any change', () => {
    const body = JSON.stringify({ token: 't', status: 'paid' });
    expect(() => verifyHmac('secret', body, hmac('secret', body))).not.toThrow();
    expect(() => verifyHmac('secret', body.replace('paid', 'failed'), hmac('secret', body))).toThrow(/signature/);
    expect(() => verifyHmac('other', body, hmac('secret', body))).toThrow(/signature/);
    expect(() => verifyHmac('secret', body, undefined)).toThrow(/signature/);
  });
});

describe('SandboxGateway', () => {
  const gw = new SandboxGateway(urls, 'k'.repeat(40));
  it('sends the browser to the test checkout page', async () => {
    expect((await gw.createCheckout({ token: 'abc' } as never)).redirectUrl).toBe('http://localhost:5173/pay/abc');
  });
  it('parses a signed webhook and rejects malformed ones', () => {
    const ok = JSON.stringify({ token: 'abc', providerTxnId: 'SBX-1', status: 'paid', method: 'card' });
    expect(gw.parseWebhook(ok, { [SANDBOX_SIGNATURE_HEADER]: hmac('k'.repeat(40), ok) }).status).toBe('paid');
    const bad = JSON.stringify({ token: 'abc', providerTxnId: 'SBX-1', status: 'paid', method: 'bitcoin' });
    expect(() => gw.parseWebhook(bad, { [SANDBOX_SIGNATURE_HEADER]: hmac('k'.repeat(40), bad) })).toThrow(/Malformed/);
  });
});

describe('smsText', () => {
  it('puts the subject first and keeps messages short', () => {
    expect(smsText({ subject: 'Fee overdue', text: 'PKR 6,000 due' })).toBe('Fee overdue\nPKR 6,000 due');
    expect(smsText({ subject: 'X', text: 'X is ready' })).toBe('X is ready');
    expect(smsText({ subject: 'S', text: 'a'.repeat(400) }).length).toBe(298); // 297 characters + '…'
  });
});
