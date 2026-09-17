import { describe, it, expect } from 'vitest';
import { toPaise, toRupeesString, formatINR } from '../../lib/money';
import { generateSchedule } from '../../lib/schedule';
import { allocatePayment } from '../../lib/allocate';
import { computePosition } from '../../lib/position';

describe('Core Money Utilities (lib/money.ts)', () => {
  it('converts rupee string/number inputs to BigInt paise accurately', () => {
    expect(toPaise('200000')).toBe(20000000n);
    expect(toPaise(200000)).toBe(20000000n);
    expect(toPaise('9986.00')).toBe(998600n);
    expect(toPaise('5000.5')).toBe(500050n);
    expect(toPaise('0.25')).toBe(25n);
  });

  it('formats BigInt paise to Rupee strings and INR currency format', () => {
    expect(toRupeesString(20000000n)).toBe('200000.00');
    expect(toRupeesString(998600n)).toBe('9986.00');
    expect(formatINR(20000000n)).toBe('2,00,000.00');
    expect(formatINR(18843100n)).toBe('1,88,431.00');
  });
});

describe('Schedule Generation (lib/schedule.ts)', () => {
  it('1. calculates EMI for ₹2,00,000 @ 18% / 24m within ±₹2 of ₹9,986', () => {
    const principal = toPaise(200000);
    const schedule = generateSchedule(principal, 1800, 24, new Date('2026-01-01'));
    
    // EMI in paise should be ~998600 ± 200 paise
    const emiRupees = Number(schedule.emiPaise) / 100;
    expect(emiRupees).toBeGreaterThanOrEqual(9984);
    expect(emiRupees).toBeLessThanOrEqual(9988);
  });

  it('2. asserts sum of principal components equals loan principal exactly and outstanding ends at 0', () => {
    const principal = toPaise(200000);
    const schedule = generateSchedule(principal, 1800, 24, new Date('2026-01-01'));
    
    const sumPrincipal = schedule.rows.reduce((acc, row) => acc + row.principalPaise, 0n);
    expect(sumPrincipal).toBe(principal);
  });

  it('3. final instalment absorbs calculation remainder', () => {
    const principal = toPaise(200000);
    const schedule = generateSchedule(principal, 1800, 24, new Date('2026-01-01'));
    
    const firstRow = schedule.rows[0];
    const lastRow = schedule.rows[schedule.rows.length - 1];
    
    expect(schedule.rows.length).toBe(24);
    expect(lastRow.principalPaise).toBeGreaterThan(0n);
    // Final total due absorbs rounding drift
    expect(lastRow.totalDuePaise).toBe(lastRow.principalPaise + lastRow.interestPaise);
  });
});

describe('Payment Allocation Engine (lib/allocate.ts)', () => {
  const sampleInstalments = [
    {
      id: 'inst-1',
      seq: 1,
      principalPaise: 698600n,
      interestPaise: 300000n,
      totalDuePaise: 998600n,
      paidPaise: 0n,
    },
    {
      id: 'inst-2',
      seq: 2,
      principalPaise: 709100n,
      interestPaise: 289500n,
      totalDuePaise: 998600n,
      paidPaise: 0n,
    },
  ];

  it('4. underpayment: ₹5,000 against ₹9,986 instalment fills interest first, nothing touches instalment 2', () => {
    const result = allocatePayment(sampleInstalments, 500000n);
    
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].instalmentId).toBe('inst-1');
    expect(result.allocations[0].interestPaise).toBe(300000n);
    expect(result.allocations[0].principalPaise).toBe(200000n);
    expect(result.updatedInstalments[0].paidPaise).toBe(500000n);
    expect(result.excessPaise).toBe(0n);
  });

  it('5. overpayment: 2x EMI settles instalment 1 & instalment 2 completely, excess 0', () => {
    const doubleEmi = 998600n * 2n;
    const result = allocatePayment(sampleInstalments, doubleEmi);
    
    expect(result.allocations).toHaveLength(2);
    expect(result.updatedInstalments[0].paidPaise).toBe(998600n);
    expect(result.updatedInstalments[1].paidPaise).toBe(998600n);
    expect(result.excessPaise).toBe(0n);
  });

  it('6. overpayment beyond final instalment sends surplus into excessPaise', () => {
    const totalDueBoth = 998600n * 2n;
    const extraSurplus = 500000n;
    const result = allocatePayment(sampleInstalments, totalDueBoth + extraSurplus);
    
    expect(result.updatedInstalments[0].paidPaise).toBe(998600n);
    expect(result.updatedInstalments[1].paidPaise).toBe(998600n);
    expect(result.excessPaise).toBe(extraSurplus);
  });
});

describe('Position Computation & Late Payment (lib/position.ts)', () => {
  it('7. overdue computation: as-of date 11 days past unpaid due date gives overdueAmount and daysPastDue == 11', () => {
    const loan = { principalPaise: 20000000n, excessPaise: 0n };
    const instalments = [
      {
        seq: 1,
        dueDate: new Date('2026-03-01'),
        principalPaise: 698600n,
        interestPaise: 300000n,
        totalDuePaise: 998600n,
        paidPaise: 498600n, // partially paid, ₹5,000 remaining due
      },
      {
        seq: 2,
        dueDate: new Date('2026-04-01'),
        principalPaise: 709100n,
        interestPaise: 289500n,
        totalDuePaise: 998600n,
        paidPaise: 0n,
      },
    ];

    // As of 11 days after 2026-03-01 = 2026-03-12
    const asOfDate = new Date('2026-03-12');
    const pos = computePosition(loan, instalments, asOfDate);

    expect(pos.overdueAmount).toBe('5000.00');
    expect(pos.daysPastDue).toBe(11);
    expect(pos.nextDueDate).toBe('2026-03-01');
    expect(pos.nextDueAmount).toBe('5000.00');
  });

  it('8. rejects invalid inputs for schedule generation & allocation', () => {
    expect(() => generateSchedule(0n, 1800, 24, new Date())).toThrow('Principal must be positive');
    expect(() => generateSchedule(20000000n, -10, 24, new Date())).toThrow('Annual rate BPS must be non-negative');
    expect(() => generateSchedule(20000000n, 1800, 0, new Date())).toThrow('Tenure must be between 1 and 36 months');
    expect(() => allocatePayment([], 0n)).toThrow('Payment amount must be greater than zero');
  });
});
