import { BadRequestException } from '@nestjs/common';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** Inclusive ranges overlap when each starts on or before the other ends. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function rangeContains(outer: DateRange, inner: DateRange): boolean {
  return outer.startDate <= inner.startDate && inner.endDate <= outer.endDate;
}

export function assertValidRange(range: DateRange, label: string): void {
  if (range.endDate <= range.startDate) {
    throw new BadRequestException(`${label} must end after it starts`);
  }
}
