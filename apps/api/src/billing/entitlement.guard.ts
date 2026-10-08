import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FEATURE_INFO, type PlanFeature } from '@schoolerp/shared';
import type { AppRequest } from '../common/request-context.js';
import { SubscriptionStateService } from './subscription-state.service.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Writes that keep working in read-only mode: signing in, daily attendance, messages, paying. */
const ALWAYS_ALLOWED = [/^\/auth\//, /^\/billing/, /^\/notifications/, /^\/attendance\/sessions\//, /^\/class-sessions\//, /^\/messages\//, /^\/staff-attendance\/check-(in|out)$/];

/** Route prefixes that belong to a plan feature. */
const FEATURE_ROUTES: [RegExp, PlanFeature, 'all' | 'write'][] = [
  [/^\/exams/, 'exams', 'all'],
  [/^\/lms/, 'lms', 'all'],
  [/^\/payroll/, 'payroll', 'all'],
  [/^\/document-requests/, 'document_requests', 'all'],
  [/^\/staff-attendance/, 'gps_attendance', 'all'],
  [/^\/settings\/domains/, 'custom_domain', 'write'],
  [/^\/settings\/school\/logo/, 'theme', 'write'],
  [/^\/campuses$/, 'multi_campus', 'write'],
];

class PaymentRequired extends HttpException {
  constructor(code: string, message: string, feature?: PlanFeature) {
    super({ statusCode: HttpStatus.PAYMENT_REQUIRED, error: 'Payment Required', code, message, ...(feature && { feature }) }, HttpStatus.PAYMENT_REQUIRED);
  }
}

/**
 * Global guard #3 (after authentication and permissions): plan features and read-only mode.
 * Data is never hidden or deleted; an expired school can still sign in, read everything, take
 * attendance and message parents, and is asked to pay before making other changes.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly state: SubscriptionStateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (req.auth?.scope !== 'school') return true;
    const path = (req.originalUrl ?? req.url).split('?')[0]!.replace(/^\/api/, '');
    if (ALWAYS_ALLOWED.some((r) => r.test(path))) return true;
    const s = await this.state.get(req.auth.schoolId);
    const write = !READS.has(req.method);

    for (const [pattern, feature, scope] of FEATURE_ROUTES) {
      if (pattern.test(path) && (scope === 'all' || write) && !s.features.includes(feature)) {
        throw new PaymentRequired('FEATURE_NOT_IN_PLAN', `${FEATURE_INFO[feature].label} is not included in your plan. Upgrade to use it.`, feature);
      }
    }
    // Choosing a brand colour is part of the theme feature; going back to the standard theme (null) is not.
    const body = req.body as { primaryColor?: unknown } | undefined;
    if (path === '/settings/school' && write && body && typeof body === 'object' && typeof body.primaryColor === 'string' && !s.features.includes('theme')) {
      throw new PaymentRequired('FEATURE_NOT_IN_PLAN', `${FEATURE_INFO.theme.label} is not included in your plan. Upgrade to use it.`, 'theme');
    }
    if (write && s.readOnly) {
      throw new PaymentRequired('SUBSCRIPTION_EXPIRED', 'Your subscription has ended. Your data is safe; choose a plan under Plans & billing to continue making changes.');
    }
    return true;
  }
}
