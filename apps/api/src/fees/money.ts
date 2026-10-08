/**
 * Money helpers. Amounts are handled as integer minor units (paisa / cents) so arithmetic
 * is exact; the database stores DECIMAL(12,2).
 */

/** "1234.5" | 1234.5 | Decimal → 123450. Parses the string form, never via floating point. */
export function toMinor(value: { toString(): string } | number | string): number {
  const s = (typeof value === 'number' ? value.toFixed(2) : value.toString()).trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid money amount: ${s}`);
  const minor = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -minor : minor;
}

/** 123450 → "1234.50" */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export interface LineIn {
  key: string;
  categoryId: string;
  amount: number; // minor units
}

export interface ConcessionIn {
  valueType: 'percentage' | 'fixed';
  /** percentage: basis points (12.5% = 1250); fixed: minor units */
  value: number;
  categoryId: string | null;
}

/**
 * Applies concessions to invoice lines. Percentages apply to each matching line's base amount;
 * fixed amounts are then spread over matching lines in order. A line's discount never exceeds
 * its amount. Returns the discount per line key.
 */
export function applyConcessions(lines: readonly LineIn[], concessions: readonly ConcessionIn[]): Map<string, number> {
  const discount = new Map(lines.map((l) => [l.key, 0]));
  const matches = (c: ConcessionIn, l: LineIn) => c.categoryId === null || c.categoryId === l.categoryId;
  const room = (l: LineIn) => l.amount - discount.get(l.key)!;

  for (const c of concessions.filter((x) => x.valueType === 'percentage')) {
    for (const l of lines) {
      if (!matches(c, l)) continue;
      const d = Math.min(room(l), Math.round((l.amount * c.value) / 10_000));
      discount.set(l.key, discount.get(l.key)! + d);
    }
  }
  for (const c of concessions.filter((x) => x.valueType === 'fixed')) {
    let left = c.value;
    for (const l of lines) {
      if (left <= 0) break;
      if (!matches(c, l)) continue;
      const d = Math.min(room(l), left);
      discount.set(l.key, discount.get(l.key)! + d);
      left -= d;
    }
  }
  return discount;
}

/** Invoice status from its amounts and due date (cancelled/waived are set explicitly, not derived). */
export function deriveStatus(total: number, paid: number, dueDate: string, today: string): 'pending' | 'partial' | 'paid' | 'overdue' {
  if (paid >= total) return 'paid';
  if (dueDate < today) return 'overdue';
  return paid > 0 ? 'partial' : 'pending';
}

/** Spreads an amount over open balances, oldest first. Returns [invoiceKey, amount] pairs. */
export function allocateOldestFirst(amount: number, open: readonly { key: string; balance: number }[]): [string, number][] {
  const out: [string, number][] = [];
  let left = amount;
  for (const inv of open) {
    if (left <= 0) break;
    if (inv.balance <= 0) continue;
    const take = Math.min(left, inv.balance);
    out.push([inv.key, take]);
    left -= take;
  }
  return out;
}
