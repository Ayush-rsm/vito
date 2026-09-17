import { PrismaClient } from '@prisma/client';
import { generateSchedule } from '../lib/schedule';
import { toPaise } from '../lib/money';

const prisma = new PrismaClient();

export const SEEDED_LOAN_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('Seeding database with default reference loan...');

  const principalPaise = toPaise(200000);
  const annualRateBps = 1800; // 18.00%
  const tenureMonths = 24;
  const disbursementDate = new Date('2026-01-01');

  const { emiPaise, rows } = generateSchedule(
    principalPaise,
    annualRateBps,
    tenureMonths,
    disbursementDate
  );

  // Delete existing demo loan if any
  await prisma.loan.deleteMany({
    where: { id: SEEDED_LOAN_ID },
  });

  const loan = await prisma.loan.create({
    data: {
      id: SEEDED_LOAN_ID,
      principalPaise,
      annualRateBps,
      tenureMonths,
      disbursementDate,
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
  });

  console.log(`Successfully seeded loan ID: ${loan.id}`);
  console.log(`Principal: ₹2,00,000 | Rate: 18% | Tenure: 24m | EMI: ₹${(Number(emiPaise) / 100).toFixed(2)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
