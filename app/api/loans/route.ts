import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/firebaseAdmin';
import { generateSchedule } from '@/lib/schedule';
import { toPaise, toRupeesString } from '@/lib/money';
import { computePosition } from '@/lib/position';

const CreateLoanSchema = z.object({
  principal: z
    .union([z.number(), z.string()])
    .refine((val) => {
      try {
        const paise = toPaise(val);
        return paise >= 5000000n && paise <= 100000000n; // ₹50,000 to ₹10,00,000
      } catch {
        return false;
      }
    }, 'Principal must be between ₹50,000 and ₹10,00,000'),
  annualRate: z
    .number()
    .min(0.01, 'Annual rate must be positive')
    .max(100, 'Annual rate cannot exceed 100%'),
  tenureMonths: z
    .number()
    .int()
    .min(1, 'Tenure must be at least 1 month')
    .max(36, 'Tenure cannot exceed 36 months'),
  disbursementDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), 'Invalid disbursement date format (YYYY-MM-DD required)'),
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const validation = CreateLoanSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid loan creation parameters',
            details: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
          },
        },
        { status: 400 }
      );
    }

    const { principal, annualRate, tenureMonths, disbursementDate } = validation.data;
    const principalPaise = toPaise(principal);
    const annualRateBps = Math.round(annualRate * 100);
    const dateObj = new Date(disbursementDate);

    const { emiPaise, rows } = generateSchedule(
      principalPaise,
      annualRateBps,
      tenureMonths,
      dateObj
    );

    const loan = await prisma.loan.create({
      data: {
        principalPaise,
        annualRateBps,
        tenureMonths,
        disbursementDate: dateObj,
        emiPaise,
        excessPaise: 0n,
        instalments: {
          create: rows.map((r) => ({
            seq: r.seq,
            dueDate: r.dueDate,
            principalPaise: r.principalPaise,
            interestPaise: r.interestPaise,
            totalDuePaise: r.totalDuePaise,
            paidPaise: 0n,
          })),
        },
      },
      include: {
        instalments: {
          orderBy: { seq: 'asc' },
        },
      },
    });

    const position = computePosition(loan, loan.instalments, new Date());

    return NextResponse.json(
      {
        data: {
          id: loan.id,
          principal: toRupeesString(loan.principalPaise),
          annualRate: annualRate,
          tenureMonths: loan.tenureMonths,
          disbursementDate: loan.disbursementDate.toISOString().split('T')[0],
          emi: toRupeesString(loan.emiPaise),
          excessAmount: toRupeesString(loan.excessPaise),
          schedule: loan.instalments.map((inst) => ({
            id: inst.id,
            seq: inst.seq,
            dueDate: inst.dueDate.toISOString().split('T')[0],
            principalComponent: toRupeesString(inst.principalPaise),
            interestComponent: toRupeesString(inst.interestPaise),
            totalDue: toRupeesString(inst.totalDuePaise),
            paidAmount: toRupeesString(inst.paidPaise),
          })),
          position,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('Error creating loan:', err);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'Failed to create loan',
        },
      },
      { status: 500 }
    );
  }
});
