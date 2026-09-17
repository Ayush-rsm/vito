/**
 * Position Computation Engine.
 * Calculates current loan status metrics relative to an asOfDate.
 */

import { toRupeesString } from './money';

export interface PositionInstalmentInput {
  seq: number;
  dueDate: Date;
  principalPaise: bigint;
  interestPaise: bigint;
  totalDuePaise: bigint;
  paidPaise: bigint;
}

export interface PositionLoanInput {
  principalPaise: bigint;
  excessPaise: bigint;
}

export interface PositionResult {
  outstandingPrincipal: string;
  nextDueDate: string | null;
  nextDueAmount: string;
  overdueAmount: string;
  daysPastDue: number;
  advanceCredit: string;
}

/** Converts a Date to YYYY-MM-DD UTC/Midnight string for comparison */
function toDateOnlyString(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses YYYY-MM-DD string into a midnight UTC/Local Date for clean diffs */
function parseDateOnly(date: Date | string): Date {
  const str = typeof date === 'string' ? date : toDateOnlyString(date);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function computePosition(
  loan: PositionLoanInput,
  instalments: PositionInstalmentInput[],
  asOfDate: Date | string = new Date()
): PositionResult {
  const asOf = parseDateOnly(asOfDate);

  let totalPrincipalPaidPaise = 0n;
  let overdueAmountPaise = 0n;
  let oldestOverdueDueDate: Date | null = null;
  let nextInstalment: PositionInstalmentInput | null = null;

  const sorted = [...instalments].sort((a, b) => a.seq - b.seq);

  for (const inst of sorted) {
    const isFullyPaid = inst.paidPaise >= inst.totalDuePaise;
    const instDueDate = parseDateOnly(inst.dueDate);
    const remainingDuePaise = inst.totalDuePaise - inst.paidPaise;

    // Calculate principal paid in this instalment
    if (inst.paidPaise > 0n) {
      const principalPaid = inst.paidPaise > inst.interestPaise
        ? inst.paidPaise - inst.interestPaise
        : 0n;
      totalPrincipalPaidPaise += principalPaid;
    }

    if (!isFullyPaid) {
      if (instDueDate.getTime() < asOf.getTime()) {
        overdueAmountPaise += remainingDuePaise;
        if (!oldestOverdueDueDate) {
          oldestOverdueDueDate = instDueDate;
        }
      }
      if (!nextInstalment) {
        nextInstalment = inst;
      }
    }
  }

  const outstandingPaise = loan.principalPaise - totalPrincipalPaidPaise;
  const safeOutstandingPaise = outstandingPaise < 0n ? 0n : outstandingPaise;

  let daysPastDue = 0;
  if (oldestOverdueDueDate) {
    const diffMs = asOf.getTime() - (oldestOverdueDueDate as Date).getTime();
    daysPastDue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  return {
    outstandingPrincipal: toRupeesString(safeOutstandingPaise),
    nextDueDate: nextInstalment ? toDateOnlyString(nextInstalment.dueDate) : null,
    nextDueAmount: nextInstalment
      ? toRupeesString(nextInstalment.totalDuePaise - nextInstalment.paidPaise)
      : '0.00',
    overdueAmount: toRupeesString(overdueAmountPaise),
    daysPastDue,
    advanceCredit: toRupeesString(loan.excessPaise),
  };
}
