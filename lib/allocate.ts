/**
 * Payment Allocation Engine.
 * Pure function to split incoming payment across schedule instalments.
 * Rule: Oldest unpaid instalment first; within instalment: interest -> principal.
 */

export interface InstalmentAllocationInput {
  id: string;
  seq: number;
  principalPaise: bigint;
  interestPaise: bigint;
  totalDuePaise: bigint;
  paidPaise: bigint;
}

export interface AllocationSplit {
  instalmentId: string;
  interestPaise: bigint;
  principalPaise: bigint;
}

export interface UpdatedInstalmentState {
  id: string;
  paidPaise: bigint;
}

export interface AllocationResult {
  allocations: AllocationSplit[];
  updatedInstalments: UpdatedInstalmentState[];
  excessPaise: bigint;
}

export function allocatePayment(
  instalments: InstalmentAllocationInput[],
  amountPaise: bigint
): AllocationResult {
  if (amountPaise <= 0n) {
    throw new Error('Payment amount must be greater than zero');
  }

  let remaining = amountPaise;
  const sorted = [...instalments].sort((a, b) => a.seq - b.seq);

  const allocations: AllocationSplit[] = [];
  const updatedInstalments: UpdatedInstalmentState[] = [];

  for (const inst of sorted) {
    const uncollected = inst.totalDuePaise - inst.paidPaise;
    if (uncollected <= 0n) {
      continue; // Instalment already fully paid
    }
    if (remaining <= 0n) {
      break;
    }

    const take = remaining < uncollected ? remaining : uncollected;

    // Calculate current interest paid vs principal paid
    const currentInterestPaid = inst.paidPaise < inst.interestPaise
      ? inst.paidPaise
      : inst.interestPaise;

    const interestNeeded = inst.interestPaise - currentInterestPaid;
    const allocInterest = take < interestNeeded ? take : interestNeeded;
    const allocPrincipal = take - allocInterest;

    allocations.push({
      instalmentId: inst.id,
      interestPaise: allocInterest,
      principalPaise: allocPrincipal,
    });

    const newPaidPaise = inst.paidPaise + take;
    updatedInstalments.push({
      id: inst.id,
      paidPaise: newPaidPaise,
    });

    remaining -= take;
  }

  return {
    allocations,
    updatedInstalments,
    excessPaise: remaining,
  };
}
