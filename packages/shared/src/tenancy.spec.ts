import { describe, expect, it } from 'vitest';
import { isValidSchoolSlug, normalizeHostname, resolveHost } from './tenancy.js';

const config = { baseDomain: 'localhost', platformHost: 'admin.localhost' };

describe('normalizeHostname', () => {
  it('lowercases and strips port and trailing dot', () => {
    expect(normalizeHostname('Demo.LocalHost:5173')).toBe('demo.localhost');
    expect(normalizeHostname('school.example.com.')).toBe('school.example.com');
  });

  it('rejects empty, IPv6 and malformed hosts', () => {
    expect(normalizeHostname(undefined)).toBeNull();
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname('[::1]:3000')).toBeNull();
    expect(normalizeHostname('bad host')).toBeNull();
  });
});

describe('resolveHost', () => {
  it('detects the platform console', () => {
    expect(resolveHost('admin.localhost:5173', config)).toEqual({ kind: 'platform' });
  });

  it('detects school subdomains', () => {
    expect(resolveHost('greenfield.localhost', config)).toEqual({ kind: 'subdomain', slug: 'greenfield' });
  });

  it('treats other hosts as custom domains', () => {
    expect(resolveHost('portal.greenfield.edu', config)).toEqual({
      kind: 'custom',
      hostname: 'portal.greenfield.edu',
    });
  });

  it('rejects the bare base domain, nested labels and reserved slugs', () => {
    expect(resolveHost('localhost', config)).toBeNull();
    expect(resolveHost('a.b.localhost', config)).toBeNull();
    expect(resolveHost('www.localhost', config)).toBeNull();
  });
});

describe('isValidSchoolSlug', () => {
  it('enforces DNS label rules', () => {
    expect(isValidSchoolSlug('greenfield-high')).toBe(true);
    expect(isValidSchoolSlug('ab')).toBe(false);
    expect(isValidSchoolSlug('-abc')).toBe(false);
    expect(isValidSchoolSlug('Abc')).toBe(false);
    expect(isValidSchoolSlug('api')).toBe(false);
  });
});
