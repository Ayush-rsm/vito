import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/firebaseAdmin';
import { allocatePayment } from '@/lib/allocate';
import { toPaise, toRupeesString } from '@/lib/money';
import { computePosition } from '@/lib/position';

const RecordPaymentSchema = z.object({
  amount: z
    .union([z.number(), z.string()])
    .refine((val) => {
      try {
        const paise = toPaise(val);
        return paise > 0n;
      } catch {
        return false;
      }
    }, 'Payment amount must be a positive number'),
  paidOn: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), 'Invalid payment date format (YYYY-MM-DD required)'),
  idempotencyKey: z.string().min(1, 'Idempotency key is required'),
});

export const POST = withAuth(async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
  try {
    const { id: loanId } = await context.params;

    if (!loanId) {
      return NextResponse.json(
        { error: { code: 'INVALID_LOAN_ID', message: 'Loan ID is required' } },
        { status: 400 }
      );
    }

    const body = await req.json();
    const validation = RecordPaymentSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid payment parameters',
            details: validation.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
          },
        },
        { status: 400 }
      );
    }

    const { amount, paidOn, idempotencyKey } = validation.data;
    const amountPaise = toPaise(amount);
    const paidOnDate = new Date(paidOn);

    // Check if loan exists
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
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
            message: `No loan found with ID ${loanId}`,
          },
        },
        { status: 404 }
      );
    }

    // Check for duplicate idempotency key (DB-enforced idempotency check)
    const existingPayment = await prisma.payment.findUnique({
      where: {
        loanId_idempotencyKey: {
          loanId,
          idempotencyKey,
        },
      },
      include: {
        allocations: true,
      },
    });

    if (existingPayment) {
      const position = computePosition(loan, loan.instalments, paidOnDate);
      return NextResponse.json(
        {
          data: {
            message: 'Payment already recorded (idempotent replay)',
            replayed: true,
            payment: {
              id: existingPayment.id,
              loanId: existingPayment.loanId,
              amount: toRupeesString(existingPayment.amountPaise),
              paidOn: existingPayment.paidOn.toISOString().split('T')[0],
              idempotencyKey: existingPayment.idempotencyKey,
              createdAt: existingPayment.createdAt,
            },
            position,
          },
        },
        { status: 200 }
      );
    }

    // Perform payment allocation calculation
    const allocationResult = allocatePayment(loan.instalments, amountPaise);

    // Execute database mutations inside an isolated transaction
    const transactionResult = await prisma.$transaction(async (tx) => {
      // 1. Create Payment record
      const payment = await tx.payment.create({
        data: {
          loanId,
          amountPaise,
          paidOn: paidOnDate,
          idempotencyKey,
        },
      });

      // 2. Create Allocation records
      if (allocationResult.allocations.length > 0) {
        await tx.allocation.createMany({
          data: allocationResult.allocations.map((alloc) => ({
            paymentId: payment.id,
            instalmentId: alloc.instalmentId,
            interestPaise: alloc.interestPaise,
            principalPaise: alloc.principalPaise,
          })),
        });
      }

      // 3. Update paidPaise on affected instalments
      for (const updated of allocationResult.updatedInstalments) {
        await tx.instalment.update({
          where: { id: updated.id },
          data: { paidPaise: updated.paidPaise },
        });
      }

      // 4. Update excessPaise on loan if surplus occurred
      let updatedLoan = loan;
      if (allocationResult.excessPaise > 0n) {
        updatedLoan = await tx.loan.update({
          where: { id: loanId },
          data: {
            excessPaise: {
              increment: allocationResult.excessPaise,
            },
          },
          include: {
            instalments: {
              orderBy: { seq: 'asc' },
            },
          },
        });
      } else {
        updatedLoan = await tx.loan.findUniqueOrThrow({
          where: { id: loanId },
          include: {
            instalments: {
              orderBy: { seq: 'asc' },
            },
          },
        });
      }

      return { payment, updatedLoan };
    });

    const updatedPosition = computePosition(
      transactionResult.updatedLoan,
      transactionResult.updatedLoan.instalments,
      paidOnDate
    );

    return NextResponse.json(
      {
        data: {
          payment: {
            id: transactionResult.payment.id,
            loanId: transactionResult.payment.loanId,
            amount: toRupeesString(transactionResult.payment.amountPaise),
            paidOn: transactionResult.payment.paidOn.toISOString().split('T')[0],
            idempotencyKey: transactionResult.payment.idempotencyKey,
            createdAt: transactionResult.payment.createdAt,
          },
          allocations: allocationResult.allocations.map((alloc) => ({
            instalmentId: alloc.instalmentId,
            interestPaid: toRupeesString(alloc.interestPaise),
            principalPaid: toRupeesString(alloc.principalPaise),
          })),
          excessAllocated: toRupeesString(allocationResult.excessPaise),
          position: updatedPosition,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('Error recording payment:', err);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'Failed to record payment',
        },
      },
      { status: 500 }
    );
  }
});
