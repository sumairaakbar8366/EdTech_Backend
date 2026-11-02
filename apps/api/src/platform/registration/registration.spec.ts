import { describe, expect, it } from 'vitest';
import { evaluate, type Context, type RegistrationInput } from './checks.js';
import { decryptNic, encryptNic, nicHash, parseNic, parseNtn, parsePkMobile, provinceOfCity } from './identity.js';
import { DEFAULT_POLICY, readPolicy, trialFor } from './trial-policy.js';

const SECRET = 'x'.repeat(40);
const NIC = '35202-1234569-1';

const good: RegistrationInput = { schoolName: 'Greenfield High School', ntn: '7654321-3', country: 'Pakistan', province: 'Punjab', city: 'Lahore', address: '1 Test Road, Gulberg, Lahore', studentCount: 320, teacherCount: 22, staffCount: 8, nic: NIC, phone: '03001234567' };
const ctx = (over: Partial<Context> = {}): Context => ({ policy: DEFAULT_POLICY, emailProof: { method: 'google' }, phoneProof: { method: 'whatsapp' }, duplicates: { ntn: false, owner: false, email: false, nameInCity: false }, ...over });
const failed = (i: RegistrationInput, c: Context) => evaluate(i, c).checks.filter((x) => !x.passed).map((x) => x.key);

describe('national ID', () => {
  it('reads a CNIC with or without dashes', () => {
    expect(parseNic('35202-1234569-1')?.digits).toBe('3520212345691');
    expect(parseNic('3520212345691')?.region).toBe('Punjab');
    expect(parseNic('35202-1234569-1')?.gender).toBe('male');
    expect(parseNic('35202-1234568-2')?.gender).toBe('female');
  });
  it('refuses numbers that cannot be a CNIC', () => {
    for (const bad of ['1234', '35202-123456-1', '9520212345691', '1111111111111', '0123456789012', '00000-1234567-1', 'abcde-1234567-1']) expect(parseNic(bad), bad).toBeNull();
  });
  it('hashes with a key, never storing the number', () => {
    const a = nicHash('3520212345691', SECRET);
    expect(a).not.toContain('3520212345691');
    expect(a).toBe(nicHash('3520212345691', SECRET));
    expect(a).not.toBe(nicHash('3520212345691', 'y'.repeat(40)));
  });
  it('keeps the CNIC encrypted so the team can read it, and only with the right key', () => {
    const token = encryptNic('3520212345691', SECRET);
    expect(token).not.toContain('3520212345691');
    expect(decryptNic(token, SECRET)).toBe('3520212345691');
    expect(decryptNic(token, 'y'.repeat(40))).toBeNull();
    expect(decryptNic(token.slice(0, -2) + 'AA', SECRET)).toBeNull();
    expect(encryptNic('3520212345691', SECRET)).not.toBe(token);
  });
});

describe('NTN, phone, place', () => {
  it('accepts an NTN or a CNIC used as NTN', () => {
    expect(parseNtn('7654321-3')?.formatted).toBe('7654321-3');
    expect(parseNtn('76543213')?.kind).toBe('ntn');
    expect(parseNtn('35202-1234569-1')?.kind).toBe('cnic');
    for (const bad of ['123', '11111111', '0000123-4', 'ABCDEFG-1']) expect(parseNtn(bad), bad).toBeNull();
  });
  it('normalises Pakistani mobiles', () => {
    expect(parsePkMobile('0300 1234567')).toBe('+923001234567');
    expect(parsePkMobile('+92 300 1234567')).toBe('+923001234567');
    for (const bad of ['0421234567', '+14155550123', '0300123', '03000000000']) expect(parsePkMobile(bad), bad).toBeNull();
  });
  it('knows which province a city is in', () => {
    expect(provinceOfCity('lahore')).toBe('Punjab');
    expect(provinceOfCity('Atlantis')).toBeNull();
  });
});

describe('what an application must pass to be received', () => {
  it('a well-formed application with proven email and phone is received', () => {
    expect(evaluate(good, ctx()).passed).toBe(true);
  });
  it('refuses bad shapes with a reason for the applicant', () => {
    expect(failed({ ...good, nic: '1234' }, ctx())).toContain('nic');
    expect(failed({ ...good, ntn: '12' }, ctx())).toContain('ntn');
    expect(failed({ ...good, phone: '12345' }, ctx())).toContain('phone');
    expect(failed({ ...good, country: 'Atlantis' }, ctx())).toContain('location');
    expect(failed({ ...good, province: 'Sindh' }, ctx())).toContain('location');
    for (const c of evaluate({ ...good, nic: '1' }, ctx({ emailProof: null })).checks.filter((x) => !x.passed)) expect(c.reason, c.key).toBeTruthy();
  });
  it('a city the list does not know is allowed: the team checks it by hand', () => {
    const r = evaluate({ ...good, city: 'Smallville' }, ctx());
    expect(r.passed).toBe(true);
    expect(r.checks.find((c) => c.key === 'location')!.detail).toMatch(/team will check/);
  });
  it('needs the email proven, and the phone when required', () => {
    expect(failed(good, ctx({ emailProof: null }))).toContain('email_proof');
    expect(failed(good, ctx({ phoneProof: null }))).toContain('phone_proof');
    expect(failed(good, ctx({ phoneProof: null, policy: { ...DEFAULT_POLICY, requirePhoneCode: false } }))).not.toContain('phone_proof');
  });
  it('refuses a second application for the same school, owner or email', () => {
    expect(failed(good, ctx({ duplicates: { ntn: true, owner: true, email: true, nameInCity: true } }))).toEqual(expect.arrayContaining(['dup_ntn', 'dup_owner', 'dup_email', 'dup_name']));
  });
  it('refuses unrealistic numbers', () => {
    expect(failed({ ...good, studentCount: 2 }, ctx())).toContain('size');
    expect(failed({ ...good, teacherCount: 0 }, ctx())).toContain('size');
    expect(failed({ ...good, studentCount: 5000, teacherCount: 3 }, ctx())).toContain('size');
  });
});

describe('trial length follows school size', () => {
  it('uses the smallest band that fits', () => {
    expect(trialFor(DEFAULT_POLICY, 40).days).toBe(14);
    expect(trialFor(DEFAULT_POLICY, 101).days).toBe(21);
    expect(trialFor(DEFAULT_POLICY, 1500).days).toBe(30);
    expect(trialFor(DEFAULT_POLICY, 90_000).days).toBe(45);
  });
  it('falls back to the defaults when the stored rules are broken', () => {
    expect(readPolicy(null).trialBands).toEqual(DEFAULT_POLICY.trialBands);
    expect(readPolicy({ trialBands: [{ upTo: 10, days: 5, label: 'x' }] }).trialBands).toEqual(DEFAULT_POLICY.trialBands);
    const p = readPolicy({ trialBands: [{ upTo: null, days: 60, label: 'all' }, { upTo: 50, days: 7, label: 'tiny' }] });
    expect(trialFor(p, 10).days).toBe(7);
    expect(trialFor(p, 51).days).toBe(60);
  });
});
