import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FEATURE_INFO, type PlanFeature } from '@schoolerp/shared';
import type { AppRequest } from '../common/request-context.js';
import { SubscriptionStateService } from './subscription-state.service.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** What a locked school can still do: sign in and manage the account, see its plan state, and pay. */
const ALLOWED_WHEN_LOCKED = [/^\/auth\//, /^\/billing(\/|$)/, /^\/subscription(\/|$)/];

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
 * Global guard #3 (after authentication and permissions): plan features and the lock.
 * After the trial (or a paid period) and its grace days end, the school is locked: people can still
 * sign in, the admin can pay, and nothing is deleted; paying unlocks everything at once.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly state: SubscriptionStateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (req.auth?.scope !== 'school') return true;
    // The platform owner's support session may open any school, even a locked one, to help it.
    if (req.auth.support) return true;
    const path = (req.originalUrl ?? req.url).split('?')[0]!.replace(/^\/api/, '');
    if (ALLOWED_WHEN_LOCKED.some((r) => r.test(path))) return true;
    const s = await this.state.get(req.auth.schoolId);
    if (s.locked) {
      throw new PaymentRequired('SUBSCRIPTION_EXPIRED', 'Your school’s subscription has ended. Your data is safe; the school admin can choose a plan under Plans & billing to unlock it.');
    }
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
    return true;
  }
}
