import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/firebaseAdmin';
import { toRupeesString } from '@/lib/money';
import { computePosition } from '@/lib/position';

export const GET = withAuth(async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: { code: 'INVALID_LOAN_ID', message: 'Loan ID is required' } },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const asOfQuery = searchParams.get('asOf');
    const asOfDate = asOfQuery && !isNaN(Date.parse(asOfQuery)) ? new Date(asOfQuery) : new Date();

    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        instalments: {
          orderBy: { seq: 'asc' },
        },
      },
    });

    if (!loan) {
      return NextResponse.json(
        {
          error: {
            code: 'LOAN_NOT_FOUND',
            message: `No loan found with ID ${id}`,
          },
        },
        { status: 404 }
      );
    }

    const position = computePosition(loan, loan.instalments, asOfDate);

    return NextResponse.json(
      {
        data: {
          id: loan.id,
          principal: toRupeesString(loan.principalPaise),
          annualRate: loan.annualRateBps / 100,
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
      { status: 200 }
    );
  } catch (err: any) {
    console.error('Error fetching loan:', err);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'Failed to fetch loan details',
        },
      },
      { status: 500 }
    );
  }
});
