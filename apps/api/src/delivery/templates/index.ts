import type { DeliveryChannel, RenderedMessage } from '../delivery.types.js';
import { emailLayout } from './layout.js';

interface Template<D> {
  /** Channels this template can be sent on. */
  channels: readonly DeliveryChannel[];
  render(data: D): RenderedMessage;
}

const define = <D>(t: Template<D>) => t;
/** "2026-11-08T…" → "8 November 2026" (Pakistan time). */
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
const EMAIL = ['email'] as const;

const CODE_PURPOSE = {
  verify: 'confirm your email address',
  change: 'confirm your new email address',
  signup: 'confirm your email and create your school',
} as const;

/**
 * Every outbound message is one of these templates, so wording lives in one place and the
 * delivery log can say what was sent without storing the body. Later modules add their own.
 */
export const TEMPLATES = {
  /** Platform console "Send test message". */
  test: define<{ sentBy: string }>({
    channels: ['email', 'sms', 'whatsapp', 'push'],
    render: ({ sentBy }) => ({
      subject: 'SchoolERP test message',
      text: `This is a test message from SchoolERP, sent by ${sentBy}. If you received it, delivery on this channel works.`,
      html: emailLayout({
        heading: 'Test message',
        paragraphs: [`This is a test message from SchoolERP, sent by ${sentBy}.`, 'If you received it, email delivery works.'],
      }),
    }),
  }),

  /** Any in-app notification, mirrored to email (always), SMS / WhatsApp (if the school chose one) and push. */
  notification: define<{ name: string; schoolName: string; title: string; body: string | null; url: string }>({
    channels: ['email', 'sms', 'whatsapp', 'push'],
    render: ({ name, schoolName, title, body, url }) => ({
      subject: `${title} · ${schoolName}`,
      text: `${schoolName}: ${title}${body ? `\n${body}` : ''}`,
      html: emailLayout({ heading: title, paragraphs: [`Dear ${name},`, ...(body ? [body] : []), `This is a notification from ${schoolName}.`], action: { label: 'Open SchoolERP', url } }),
      url,
    }),
  }),

  /** Monday summary for school admins. */
  weekly_report: define<{
    name: string; schoolName: string; from: string; to: string; url: string;
    students: number; newStudents: number; attendancePercent: number | null; collected: number; paymentsCount: number;
    outstanding: number; overdueInvoices: number; admissions: number; jobApplications: number; flaggedCheckIns: number;
  }>({
    channels: EMAIL,
    render: (d) => {
      const money = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;
      const lines = [
        `Students: ${d.students} active (${d.newStudents} new this week)`,
        `Student attendance: ${d.attendancePercent === null ? 'no classes marked' : `${d.attendancePercent}% present`}`,
        `Fees collected: ${money(d.collected)} in ${d.paymentsCount} payment${d.paymentsCount === 1 ? '' : 's'}`,
        `Outstanding fees: ${money(d.outstanding)} · ${d.overdueInvoices} overdue invoice${d.overdueInvoices === 1 ? '' : 's'}`,
        `New admission applications: ${d.admissions}`,
        `New job applications: ${d.jobApplications}`,
        `Staff check-ins to review (outside the campus range): ${d.flaggedCheckIns}`,
      ];
      const p = [`Dear ${d.name},`, `Here is ${d.schoolName}'s week from ${fmtDate(d.from)} to ${fmtDate(d.to)}:`, ...lines];
      return { subject: `${d.schoolName} · weekly report`, text: `${p.join('\n')}\n\nFull reports: ${d.url}`, html: emailLayout({ heading: 'Your weekly report', paragraphs: p, action: { label: 'Open reports', url: d.url } }) };
    },
  }),

  /** One-time code (OTP) that proves the person can read this mailbox. */
  email_code: define<{ code: string; purpose: keyof typeof CODE_PURPOSE; minutes: number; schoolName?: string }>({
    channels: EMAIL,
    render: ({ code, purpose, minutes, schoolName }) => {
      const lead = `Use this code to ${CODE_PURPOSE[purpose]}${schoolName ? ` at ${schoolName}` : ''}:`;
      const tail = `The code expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.`;
      return {
        subject: `${code} is your SchoolERP verification code`,
        text: `${lead}\n\n${code}\n\n${tail}`,
        html: emailLayout({ heading: 'Your verification code', paragraphs: [lead], code, footer: tail }),
      };
    },
  }),

  /** "Forgot password": a one-use link. */
  password_reset: define<{ name: string; url: string; minutes: number; loginId?: string; schoolName?: string }>({
    channels: EMAIL,
    render: ({ name, url, minutes, loginId, schoolName }) => {
      const p = [
        `Hello ${name},`,
        `We received a request to reset the password${loginId ? ` for User ID ${loginId}` : ''}${schoolName ? ` at ${schoolName}` : ''}.`,
        `The link works once and expires in ${minutes} minutes. If you did not ask for this, ignore this email: your password stays the same.`,
      ];
      return {
        subject: 'Reset your SchoolERP password',
        text: `${p.join('\n\n')}\n\nReset your password: ${url}`,
        html: emailLayout({ heading: 'Reset your password', paragraphs: p, action: { label: 'Choose a new password', url } }),
      };
    },
  }),

  /** "Forgot User ID": every account at the school that uses this email. */
  user_ids: define<{ schoolName: string; accounts: { name: string; loginId: string; role: string }[]; signInUrl: string }>({
    channels: EMAIL,
    render: ({ schoolName, accounts, signInUrl }) => {
      const lines = accounts.map((a) => `${a.loginId}  ·  ${a.name} (${a.role})`);
      const p = [`These ${schoolName} accounts use your email address:`, ...lines, 'Sign in with your email (or the User ID); if you have also forgotten the password, use "Forgot password" on the sign-in page.'];
      return {
        subject: `Your ${schoolName} User ID${accounts.length > 1 ? 's' : ''}`,
        text: `${p.join('\n')}\n\nSign in: ${signInUrl}`,
        html: emailLayout({ heading: 'Your User ID', paragraphs: p, action: { label: 'Go to sign in', url: signInUrl } }),
      };
    },
  }),

  /** A new login. The temporary password is included only when the address was verified by OTP. */
  account_created: define<{ schoolName: string; name: string; loginId: string; signInUrl: string; temporaryPassword?: string; google?: boolean }>({
    channels: EMAIL,
    render: ({ schoolName, name, loginId, signInUrl, temporaryPassword, google }) => {
      const p = [
        `Assalam o Alaikum ${name},`,
        `Your ${schoolName} account is ready. Sign in with this email address and the password below.`,
        `Your User ID (record number, also works for signing in): ${loginId}`,
        temporaryPassword
          ? `Temporary password: ${temporaryPassword}  (you will choose your own password at first sign-in)`
          : 'Your school will give you a temporary password. You will choose your own password at first sign-in.',
        ...(google ? ['Or simply use "Continue with Google" on the sign-in page with this email address.'] : []),
        'Your User ID never changes; keep it for the school office.',
      ];
      return {
        subject: `Your ${schoolName} account: User ID ${loginId}`,
        text: `${p.join('\n\n')}\n\nSign in: ${signInUrl}`,
        html: emailLayout({ heading: 'Your account is ready', paragraphs: p, action: { label: 'Sign in', url: signInUrl } }),
      };
    },
  }),

  /** Self-service sign-up finished: the school is live on a free trial. */
  school_signup_welcome: define<{ name: string; schoolName: string; loginId: string; signInUrl: string; trialEndsAt: string; password?: string; provider?: string }>({
    channels: EMAIL,
    render: ({ name, schoolName, loginId, signInUrl, trialEndsAt, password, provider }) => {
      const p = [
        `Welcome ${name},`,
        `${schoolName} is ready on SchoolERP. Your free trial includes every feature until ${fmtDate(trialEndsAt)}.`,
        password
          ? `Your sign-in details. User ID: ${loginId} · Password: ${password}. Please change the password after you sign in (Profile → Change password).`
          : `Sign in with this email and the password you chose. Your User ID: ${loginId}`,
        ...(provider ? [`You can also sign in any time with "Continue with ${provider}" using the same account.`] : []),
        'Next: add your classes, staff and students; each person gets their own User ID and sign-in details by email.',
      ];
      return { subject: `${schoolName} is ready: your User ID is ${loginId}`, text: `${p.join('\n\n')}\n\nSign in: ${signInUrl}`, html: emailLayout({ heading: 'Your school is ready', paragraphs: p, action: { label: 'Open your school', url: signInUrl } }) };
    },
  }),

  /** To the platform owner: someone signed up. */
  owner_new_signup: define<{ schoolName: string; slug: string; contact: string; email: string; phone: string | null; city: string | null; trialEndsAt: string; consoleUrl: string; method?: string }>({
    channels: EMAIL,
    render: (d) => {
      const p = [`${d.schoolName} (${d.slug}) signed up and started a free trial until ${fmtDate(d.trialEndsAt)}.`, `Contact: ${d.contact}`, `Email: ${d.email}`, ...(d.phone ? [`Phone: ${d.phone}`] : []), ...(d.city ? [`City: ${d.city}`] : []), ...(d.method ? [`Signed up with: ${d.method}`] : [])];
      return { subject: `New sign-up: ${d.schoolName}`, text: `${p.join('\n')}\n\n${d.consoleUrl}`, html: emailLayout({ heading: 'New school sign-up', paragraphs: p, action: { label: 'Open the console', url: d.consoleUrl } }) };
    },
  }),

  /** Online payment received: receipt to the school's admins. */
  payment_receipt: define<{ name: string; schoolName: string; plan: string; cycle: string; amount: string; method: string; txnId: string; periodEnd: string; reason: string; billingUrl: string }>({
    channels: EMAIL,
    render: (d) => {
      const p = [
        `Hello ${d.name},`,
        `Thank you! We received PKR ${Number(d.amount).toLocaleString('en-PK', { minimumFractionDigits: 2 })} for the ${d.plan} plan (${d.cycle === 'annual' ? '1 year' : '1 month'}) of ${d.schoolName}.`,
        `Paid by: ${d.method}`,
        `Transaction: ${d.txnId}`,
        `Your plan is active until ${fmtDate(d.periodEnd)}.`,
      ];
      return { subject: `Payment received · ${d.schoolName} · ${d.plan} plan`, text: `${p.join('\n')}\n\n${d.billingUrl}`, html: emailLayout({ heading: 'Payment received', paragraphs: p, action: { label: 'View billing', url: d.billingUrl } }) };
    },
  }),

  payment_failed: define<{ name: string; schoolName: string; plan: string; cycle: string; amount: string; method: string; txnId: string; periodEnd: string; reason: string; billingUrl: string }>({
    channels: EMAIL,
    render: (d) => {
      const p = [`Hello ${d.name},`, `The online payment of PKR ${Number(d.amount).toLocaleString('en-PK')} for the ${d.plan} plan of ${d.schoolName} did not go through.`, `Reason: ${d.reason || 'declined'}`, 'Nothing was charged. You can try again with another card, a bank account, JazzCash or Easypaisa.'];
      return { subject: `Payment not completed · ${d.schoolName}`, text: `${p.join('\n')}\n\n${d.billingUrl}`, html: emailLayout({ heading: 'Payment not completed', paragraphs: p, action: { label: 'Try again', url: d.billingUrl } }) };
    },
  }),

  /** To the platform owner: an online payment came in (plan already active). */
  owner_payment_received: define<{ schoolName: string; plan: string; cycle: string; amount: string; method: string; txnId: string; consoleUrl: string }>({
    channels: EMAIL,
    render: (d) => {
      const p = [`${d.schoolName} paid PKR ${Number(d.amount).toLocaleString('en-PK')} for the ${d.plan} plan (${d.cycle}).`, `Method: ${d.method}`, `Transaction: ${d.txnId}`, 'The plan was activated automatically.'];
      return { subject: `Payment: ${d.schoolName} · PKR ${Number(d.amount).toLocaleString('en-PK')}`, text: `${p.join('\n')}\n\n${d.consoleUrl}`, html: emailLayout({ heading: 'Online payment received', paragraphs: p, action: { label: 'Open payments', url: d.consoleUrl } }) };
    },
  }),

  /** Security notice after any password change. */
  password_changed: define<{ name: string; loginId?: string; byAdmin: boolean; schoolName?: string }>({
    channels: EMAIL,
    render: ({ name, loginId, byAdmin, schoolName }) => {
      const p = [
        `Hello ${name},`,
        byAdmin
          ? `An administrator${schoolName ? ` at ${schoolName}` : ''} reset the password${loginId ? ` of User ID ${loginId}` : ''}. Ask them for the temporary password; you will choose a new one when you sign in.`
          : `The password${loginId ? ` of User ID ${loginId}` : ''} was just changed. All other sessions were signed out.`,
        'If this was not you, contact your school administrator immediately.',
      ];
      return { subject: 'Your SchoolERP password was changed', text: p.join('\n\n'), html: emailLayout({ heading: 'Password changed', paragraphs: p }) };
    },
  }),
};

export type TemplateName = keyof typeof TEMPLATES;
export type TemplateData<N extends TemplateName> = Parameters<(typeof TEMPLATES)[N]['render']>[0];
