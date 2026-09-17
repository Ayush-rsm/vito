/**
 * Loan repayment schedule generation logic.
 * Uses exact BigInt paise arithmetic and integer half-up rounding.
 */

export interface ScheduleRow {
  seq: number;
  dueDate: Date;
  principalPaise: bigint;
  interestPaise: bigint;
  totalDuePaise: bigint;
}

export interface GeneratedSchedule {
  emiPaise: bigint;
  rows: ScheduleRow[];
}

/** Utility to add N months to a Date, correctly handling short months */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== day) {
    result.setDate(0);
  }
  return result;
}

/**
 * Generates an immutable repayment schedule for a loan.
 *
 * @param principalPaise Total principal in paise (bigint)
 * @param annualRateBps Annual rate in basis points (e.g., 1800 = 18.00%)
 * @param tenureMonths Tenure in months (1..36)
 * @param disbursementDate Date of loan disbursement
 */
export function generateSchedule(
  principalPaise: bigint,
  annualRateBps: number,
  tenureMonths: number,
  disbursementDate: Date
): GeneratedSchedule {
  if (principalPaise <= 0n) throw new Error('Principal must be positive');
  if (annualRateBps < 0) throw new Error('Annual rate BPS must be non-negative');
  if (tenureMonths <= 0 || tenureMonths > 36) throw new Error('Tenure must be between 1 and 36 months');

  const P = Number(principalPaise);
  const r = annualRateBps / 120000; // Monthly interest rate decimal
  const n = tenureMonths;

  // Calculate EMI float in paise, then round half-up to nearest paisa
  const emiFloat = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const emiPaise = BigInt(Math.round(emiFloat));

  let outstandingPaise = principalPaise;
  const rows: ScheduleRow[] = [];

  for (let seq = 1; seq <= n; seq++) {
    const dueDate = addMonths(disbursementDate, seq);

    let interestPaise: bigint;
    let principalPaise: bigint;
    let totalDuePaise: bigint;

    if (seq === n) {
      // Final instalment absorbs remaining principal and calculation drift
      interestPaise = (outstandingPaise * BigInt(annualRateBps) + 60000n) / 120000n;
      principalPaise = outstandingPaise;
      totalDuePaise = principalPaise + interestPaise;
    } else {
      interestPaise = (outstandingPaise * BigInt(annualRateBps) + 60000n) / 120000n;
      principalPaise = emiPaise - interestPaise;
      totalDuePaise = emiPaise;
    }

    rows.push({
      seq,
      dueDate,
      principalPaise,
      interestPaise,
      totalDuePaise,
    });

    outstandingPaise -= principalPaise;
  }

  return {
    emiPaise,
    rows,
  };
}
