import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Pure checks on the identity details a school gives when it registers: national ID (NIC / CNIC),
 * NTN, mobile number, and how closely a name matches the one on a registry. No I/O, so they are
 * easy to test and cannot be talked around.
 */

export const PAKISTAN = 'Pakistan';

/** First digit of a CNIC → the province or territory it was issued for. */
export const NIC_REGION: Record<string, string> = { '1': 'Khyber Pakhtunkhwa', '2': 'Khyber Pakhtunkhwa', '3': 'Punjab', '4': 'Sindh', '5': 'Balochistan', '6': 'Islamabad Capital Territory', '7': 'Gilgit-Baltistan', '8': 'Azad Jammu & Kashmir' };

export const PROVINCES = ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Gilgit-Baltistan', 'Azad Jammu & Kashmir'] as const;

/** Cities and larger towns by province (a school in a place not listed is checked against the registry instead). */
export const CITIES: Record<(typeof PROVINCES)[number], string[]> = {
  Punjab: ['Lahore', 'Faisalabad', 'Rawalpindi', 'Multan', 'Gujranwala', 'Sialkot', 'Bahawalpur', 'Sargodha', 'Sheikhupura', 'Jhang', 'Gujrat', 'Kasur', 'Rahim Yar Khan', 'Sahiwal', 'Okara', 'Wah Cantonment', 'Dera Ghazi Khan', 'Mianwali', 'Chiniot', 'Kamoke', 'Hafizabad', 'Sadiqabad', 'Burewala', 'Jhelum', 'Khanewal', 'Muzaffargarh', 'Attock', 'Vehari', 'Bhakkar', 'Layyah', 'Narowal', 'Mandi Bahauddin', 'Toba Tek Singh', 'Khushab', 'Pakpattan', 'Lodhran', 'Rajanpur', 'Bahawalnagar', 'Chakwal', 'Murree', 'Nankana Sahib', 'Gojra', 'Daska', 'Wazirabad'],
  Sindh: ['Karachi', 'Hyderabad', 'Sukkur', 'Larkana', 'Nawabshah', 'Mirpur Khas', 'Jacobabad', 'Shikarpur', 'Khairpur', 'Dadu', 'Thatta', 'Badin', 'Tando Allahyar', 'Tando Adam', 'Umerkot', 'Ghotki', 'Sanghar', 'Kotri', 'Jamshoro', 'Kashmore', 'Matiari', 'Naushahro Feroze'],
  'Khyber Pakhtunkhwa': ['Peshawar', 'Mardan', 'Mingora', 'Abbottabad', 'Kohat', 'Dera Ismail Khan', 'Swabi', 'Nowshera', 'Charsadda', 'Mansehra', 'Bannu', 'Haripur', 'Swat', 'Chitral', 'Hangu', 'Karak', 'Lakki Marwat', 'Batkhela', 'Tank', 'Timergara', 'Dir', 'Buner', 'Khyber'],
  Balochistan: ['Quetta', 'Turbat', 'Khuzdar', 'Chaman', 'Gwadar', 'Sibi', 'Zhob', 'Loralai', 'Dera Murad Jamali', 'Nushki', 'Kalat', 'Mastung', 'Pishin', 'Panjgur', 'Hub', 'Jaffarabad', 'Kharan', 'Lasbela'],
  'Islamabad Capital Territory': ['Islamabad'],
  'Gilgit-Baltistan': ['Gilgit', 'Skardu', 'Hunza', 'Chilas', 'Ghanche', 'Astore', 'Ghizer', 'Diamer'],
  'Azad Jammu & Kashmir': ['Muzaffarabad', 'Mirpur', 'Rawalakot', 'Kotli', 'Bagh', 'Bhimber', 'Neelum', 'Sudhanoti', 'Haveli'],
};

export const COUNTRIES = [PAKISTAN] as const;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The province a city belongs to, or null when the city is not in the list. */
export function provinceOfCity(city: string): (typeof PROVINCES)[number] | null {
  const c = squash(city);
  for (const p of PROVINCES) if (CITIES[p].some((x) => squash(x) === c)) return p;
  return null;
}

export function canonicalProvince(raw: string): (typeof PROVINCES)[number] | null {
  const v = squash(raw);
  const alias: Record<string, (typeof PROVINCES)[number]> = { kpk: 'Khyber Pakhtunkhwa', nwfp: 'Khyber Pakhtunkhwa', ict: 'Islamabad Capital Territory', islamabad: 'Islamabad Capital Territory', ajk: 'Azad Jammu & Kashmir', 'azad kashmir': 'Azad Jammu & Kashmir', gb: 'Gilgit-Baltistan', 'gilgit baltistan': 'Gilgit-Baltistan', 'azad jammu kashmir': 'Azad Jammu & Kashmir' };
  return PROVINCES.find((p) => squash(p) === v) ?? alias[v] ?? null;
}

// --- National ID (CNIC / NIC) -------------------------------------------------------------------

export interface NicInfo { digits: string; formatted: string; region: string; gender: 'male' | 'female'; last4: string }

/** A 13-digit CNIC, written 12345-1234567-1 or 1234512345671; null when it cannot be one. */
export function parseNic(raw: string): NicInfo | null {
  const t = raw.trim();
  if (!/^\d{5}-?\d{7}-?\d$/.test(t)) return null;
  const digits = t.replace(/-/g, '');
  const region = NIC_REGION[digits[0]!];
  if (!region) return null;
  // All one digit, or a plain run of digits, is somebody typing numbers, not a card.
  if (/^(\d)\1{12}$/.test(digits) || '01234567890123456789'.includes(digits) || '98765432109876543210'.includes(digits)) return null;
  // The district code (first five digits) is never 00000.
  if (digits.slice(0, 5) === '00000') return null;
  return { digits, formatted: `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`, region, gender: Number(digits[12]) % 2 === 1 ? 'male' : 'female', last4: digits.slice(-4) };
}

/** Keyed hash of a national ID: lets us spot the same person twice without keeping the number. */
export function nicHash(digits: string, secret: string): string {
  return createHmac('sha256', secret).update(`nic:${digits}`).digest('hex');
}

// --- NTN ------------------------------------------------------------------------------------------

/** National Tax Number: seven digits and a check digit (1234567-8), or the owner's CNIC for an individual. */
export function parseNtn(raw: string): { digits: string; formatted: string; kind: 'ntn' | 'cnic' } | null {
  const t = raw.trim();
  if (/^\d{7}-?\d$/.test(t)) {
    const digits = t.replace(/-/g, '');
    if (/^(\d)\1{7}$/.test(digits) || digits === '12345678' || digits.startsWith('0000')) return null;
    return { digits, formatted: `${digits.slice(0, 7)}-${digits.slice(7)}`, kind: 'ntn' };
  }
  const nic = parseNic(t);
  return nic ? { digits: nic.digits, formatted: nic.formatted, kind: 'cnic' } : null;
}

// --- Phone ----------------------------------------------------------------------------------------

/** A Pakistani mobile number in international form (+923001234567); null for anything else. */
export function parsePkMobile(raw: string): string | null {
  let v = raw.trim().replace(/[\s()-]/g, '');
  if (/^03\d{9}$/.test(v)) v = `+92${v.slice(1)}`;
  else if (/^0092\d{10}$/.test(v)) v = `+${v.slice(2)}`;
  else if (/^92\d{10}$/.test(v)) v = `+${v}`;
  if (!/^\+923\d{9}$/.test(v)) return null;
  if (/^\+923(\d)\1{8}$/.test(v)) return null;
  return v;
}

// --- Keeping the CNIC only until the team has checked it ---------------------------------------

/** AES-256-GCM: the team needs the real number to check it on NADRA's portal, so it is kept encrypted until then. */
export function encryptNic(digits: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(`nic-key:${secret}`).digest(), iv);
  const enc = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptNic(token: string, secret: string): string | null {
  try {
    const [iv, tag, enc] = token.split('.').map((x) => Buffer.from(x ?? '', 'base64url'));
    const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(`nic-key:${secret}`).digest(), iv!);
    d.setAuthTag(tag!);
    return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const sameText = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && squash(a) === squash(b);
