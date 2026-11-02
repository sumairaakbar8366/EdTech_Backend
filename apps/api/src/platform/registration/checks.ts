import { canonicalProvince, parseNic, parseNtn, parsePkMobile, provinceOfCity, PAKISTAN } from './identity.js';
import type { RegistrationPolicy } from './trial-policy.js';

/** What the person typed (already trimmed). */
export interface RegistrationInput {
  schoolName: string;
  ntn: string;
  country: string;
  province: string;
  city: string;
  address: string;
  studentCount: number;
  teacherCount: number;
  staffCount: number;
  nic: string;
  phone: string;
}

export interface Context {
  policy: RegistrationPolicy;
  emailProof: { method: 'google' | 'email' } | null;
  phoneProof: { method: 'whatsapp' | 'sms' } | null;
  /** An application (waiting or approved) already exists for the same NTN, owner, email or school name in the city. */
  duplicates: { ntn: boolean; owner: boolean; email: boolean; nameInCity: boolean };
}

export interface Check {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  reason?: string;
}

const ok = (key: string, label: string, detail: string): Check => ({ key, label, passed: true, detail });
const bad = (key: string, label: string, detail: string, reason: string): Check => ({ key, label, passed: false, detail, reason });

/**
 * The quick checks an application must pass to be received at all: the details have the right shape,
 * the email (and phone) were proven, the numbers are realistic, and nothing like it is already on file.
 * Whether the school and its owner are genuine is decided by the owner's team afterwards, by hand.
 */
export function evaluate(i: RegistrationInput, ctx: Context): { checks: Check[]; passed: boolean } {
  const checks: Check[] = [];
  const { policy } = ctx;

  const nic = parseNic(i.nic);
  checks.push(nic ? ok('nic', 'National ID (CNIC) format', `Valid 13-digit CNIC ending ${nic.last4}`) : bad('nic', 'National ID (CNIC) format', 'Not a valid 13-digit CNIC', 'Enter your 13-digit CNIC as 12345-1234567-1.'));
  const ntn = parseNtn(i.ntn);
  checks.push(ntn ? ok('ntn', 'NTN format', `${ntn.kind === 'ntn' ? 'NTN' : 'CNIC used as NTN'} ${ntn.formatted}`) : bad('ntn', 'NTN format', 'Not a valid NTN', 'Enter the NTN as 1234567-8.'));
  const phone = parsePkMobile(i.phone);
  checks.push(phone ? ok('phone', 'Mobile number', phone) : bad('phone', 'Mobile number', 'Not a Pakistani mobile number', 'Enter a Pakistani mobile number such as 0300 1234567.'));

  checks.push(ctx.emailProof ? ok('email_proof', 'Email verified', ctx.emailProof.method === 'google' ? 'Signed in with Google' : 'Code emailed and entered') : bad('email_proof', 'Email verified', 'No proof of the mailbox', 'Verify your email with Google or the emailed code.'));
  if (policy.requirePhoneCode) {
    checks.push(ctx.phoneProof ? ok('phone_proof', 'Mobile verified', `Code sent by ${ctx.phoneProof.method} and entered`) : bad('phone_proof', 'Mobile verified', 'No proof of the phone', 'Verify your mobile number with the WhatsApp code.'));
  }

  const province = canonicalProvince(i.province);
  const countryOk = policy.allowedCountries.some((c) => c.trim().toLowerCase() === i.country.trim().toLowerCase());
  const cityProvince = provinceOfCity(i.city);
  if (!countryOk) checks.push(bad('location', 'Country, province and city', `${i.country} is not open for registration`, `Registration is not open in ${i.country || 'this country'} yet.`));
  else if (i.country !== PAKISTAN) checks.push(ok('location', 'Country, province and city', `${i.city}, ${i.province}, ${i.country}`));
  else if (!province) checks.push(bad('location', 'Country, province and city', `Unknown province "${i.province}"`, 'Choose a province from the list.'));
  else if (cityProvince && cityProvince !== province) checks.push(bad('location', 'Country, province and city', `${i.city} is in ${cityProvince}, not ${province}`, `${i.city} is not in ${province}. Check the province and city.`));
  else checks.push(ok('location', 'Country, province and city', cityProvince ? `${i.city} is in ${province}` : `${i.city} is not in the built-in place list: the team will check it`));

  const dup = ctx.duplicates;
  checks.push(dup.ntn ? bad('dup_ntn', 'Not applied before (NTN)', 'An application or school with this NTN exists', 'An application for this school is already on file. If you did not make it, contact us.') : ok('dup_ntn', 'Not applied before (NTN)', 'No earlier application with this NTN'));
  checks.push(dup.owner ? bad('dup_owner', 'Not applied before (owner)', 'This CNIC already has an application', 'This person has already applied.') : ok('dup_owner', 'Not applied before (owner)', 'No earlier application with this CNIC'));
  checks.push(dup.email ? bad('dup_email', 'Not applied before (email)', 'This email already has an application', 'This email address has already been used to apply.') : ok('dup_email', 'Not applied before (email)', 'Email not used before'));
  checks.push(dup.nameInCity ? bad('dup_name', 'Not applied before (name and city)', 'A school with this name exists in this city', 'A school with this name already exists in this city.') : ok('dup_name', 'Not applied before (name and city)', 'No school with this name in this city'));

  const { studentCount: s, teacherCount: t, staffCount: o } = i;
  const problem =
    s < policy.minStudents ? `at least ${policy.minStudents} students are needed` : s > policy.maxStudents ? `more than ${policy.maxStudents} students is not accepted online` : t < 1 ? 'at least one teacher is needed' : s / t > 120 ? 'the number of students per teacher is not realistic' : t > s * 2 + 50 ? 'there are far more teachers than students' : o > s + t + 500 ? 'the number of other staff is not realistic' : null;
  checks.push(problem ? bad('size', 'School size is realistic', `${s} students, ${t} teachers, ${o} other staff: ${problem}`, `The numbers of students and staff do not look right: ${problem}.`) : ok('size', 'School size is realistic', `${s} students, ${t} teachers, ${o} other staff`));

  return { checks, passed: checks.every((c) => c.passed) };
}
