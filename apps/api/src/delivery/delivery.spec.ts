import { describe, expect, it } from 'vitest';
import { queueConnection } from '../jobs/queue-connection.js';
import { normaliseRecipient } from './delivery.service.js';
import { emailLayout, esc } from './templates/layout.js';
import { TEMPLATES } from './templates/index.js';

describe('normaliseRecipient', () => {
  it('lower-cases and trims email addresses', () => {
    expect(normaliseRecipient('email', '  Sara.Khan@Example.PK ')).toBe('sara.khan@example.pk');
  });

  it('rejects invalid email addresses', () => {
    expect(() => normaliseRecipient('email', 'not-an-email')).toThrow(/valid email/);
  });

  it('accepts international phone numbers and strips spaces and dashes', () => {
    expect(normaliseRecipient('sms', '+92 300-123 4567')).toBe('+923001234567');
    expect(normaliseRecipient('whatsapp', '+923001234567')).toBe('+923001234567');
  });

  it('reads local and 0092 numbers as Pakistani', () => {
    expect(normaliseRecipient('sms', '0300 1234567')).toBe('+923001234567');
    expect(normaliseRecipient('whatsapp', '00923001234567')).toBe('+923001234567');
  });

  it('rejects numbers that are neither international nor Pakistani local', () => {
    expect(() => normaliseRecipient('sms', '1234567')).toThrow(/international/);
  });
});

describe('queueConnection', () => {
  it('parses host, port, credentials and db, with no request retry limit', () => {
    expect(queueConnection('redis://user:p%40ss@cache.local:6380/2')).toMatchObject({
      host: 'cache.local',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: undefined,
      maxRetriesPerRequest: null,
    });
  });

  it('defaults the port and db and enables TLS for rediss://', () => {
    expect(queueConnection('rediss://localhost')).toMatchObject({ port: 6379, db: 0, tls: {} });
  });
});

describe('templates', () => {
  it('escapes user text in HTML email bodies', () => {
    expect(esc('<b>"A" & \'B\'</b>')).toBe('&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
    const html = emailLayout({ heading: 'Hi <script>', paragraphs: ['x & y'] });
    expect(html).toContain('Hi &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders the test template on every channel', () => {
    const m = TEMPLATES.test.render({ sentBy: 'owner@schoolerp.local' });
    expect(m.subject).toBe('SchoolERP test message');
    expect(m.text).toContain('owner@schoolerp.local');
    expect(TEMPLATES.test.channels).toEqual(['email', 'sms', 'whatsapp', 'push']);
  });
});
