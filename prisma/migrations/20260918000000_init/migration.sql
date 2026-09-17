-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL,
    "principal_paise" BIGINT NOT NULL,
    "annual_rate_bps" INTEGER NOT NULL,
    "tenure_months" INTEGER NOT NULL,
    "disbursement_date" DATE NOT NULL,
    "emi_paise" BIGINT NOT NULL,
    "excess_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalments" (
    "id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "principal_paise" BIGINT NOT NULL,
    "interest_paise" BIGINT NOT NULL,
    "total_due_paise" BIGINT NOT NULL,
    "paid_paise" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "instalment_id" UUID NOT NULL,
    "interest_paise" BIGINT NOT NULL,
    "principal_paise" BIGINT NOT NULL,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instalments_loan_id_seq_key" ON "instalments"("loan_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "payments_loan_id_idempotency_key_key" ON "payments"("loan_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "instalments" ADD CONSTRAINT "instalments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_instalment_id_fkey" FOREIGN KEY ("instalment_id") REFERENCES "instalments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
