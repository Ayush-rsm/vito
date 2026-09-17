# Loan Repayment Service (Vitto Full Stack SDE Assignment)

A Next.js (App Router, TypeScript) service that generates loan repayment schedules, processes payment allocations, and computes real-time loan positions. Built with PostgreSQL, Prisma ORM, Firebase Authentication, and Vitest.

---

## 1. Quick Start Setup

Follow these exact steps from a fresh clone:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env

# 3. Initialize database migrations & seed default reference loan
npm run db:setup

# 4. Launch development server
npm run dev
```

Visit `http://localhost:3000` in your browser.

---

## 2. Test Command

Run the unit and integration test suite:

```bash
npm test
```

* **Unit tests (`tests/unit/core.test.ts`)**: Verify EMI calculations, exact schedule principal summation, half-up rounding, allocation priority (interest-first, principal-second), overpayment cascades, surplus to excess, and DPD calculations.
* **Integration tests (`tests/integration/api.test.ts`)**: Execute API route handlers (`POST /api/loans`, `GET /api/loans/[id]`, `POST /api/loans/[id]/payments`), testing authentication guards (`401`), Zod validation (`400`), idempotency replay (`200`), and non-existent loans (`404`).

---

## 3. Database Architecture

* **Database Engine**: PostgreSQL (tested with Neon PostgreSQL and local PostgreSQL).
* **ORM**: Prisma ORM with explicit integer BigInt schemas.
* **Schema Enforcement**: Foreign key constraints with `ON DELETE CASCADE` and `payments.loan_id NOT NULL`. A payment cannot exist without an associated loan.
* **Setup Script**: `npm run db:setup` executes `prisma migrate deploy` followed by `prisma/seed.ts`.

---

## 4. Architectural Decisions & Judgement Calls

### Money Type & Floating-Point Safety
* **Choice**: `BIGINT` storing integer **paise** (minor units, e.g., ₹2,00,000 = `20000000n` paise).
* **Rationale**: Eliminates IEEE 754 floating-point inaccuracies (e.g. `19.99 * 100 = 1998.9999999999998`).
* **Input Parsing**: Inputs are converted via string splitting (`toPaise`) rather than `parseFloat()`.

### EMI & Schedule Rounding
* **Formula**: Standard reference formula: $\text{EMI} = P \times r \times \frac{(1+r)^n}{(1+r)^n - 1}$
* **Rounding**: Computed in paise, rounded half-up to the nearest paisa. Matches ₹9,986 reference for ₹2,00,000 @ 18% / 24 months.
* **Remainder Absorption**: The final instalment absorbs rounding drift, guaranteeing $\sum \text{principal} == \text{loan principal}$ exactly down to the last paisa.

### Payment Allocation Rules
1. **Sequence Order**: Oldest unpaid instalment first (`seq` 1, 2, ...).
2. **Component Priority**: Within an instalment: **Interest first**, then **Principal**.
3. **Overpayment**: Cascades forward to settle subsequent instalments in order. Prepayment closure / tenure reduction is out of scope.
4. **Surplus Beyond Tenure**: Stored as `excess_paise` on the loan record, reported as `advanceCredit` in position metrics.

### Late Payment & Overdue
* **Penalty Interest**: Out of scope per assignment brief.
* **Position Representation**: 
  * `overdueAmount`: Sum of remaining total due across all instalments where `due_date < as_of_date`.
  * `daysPastDue`: Number of days elapsed between `as_of_date` and the `due_date` of the **oldest unpaid overdue instalment**.

### Idempotency & Duplicate Submissions
* **Mechanism**: Client includes `idempotencyKey` on payment requests. Database enforces `@@unique([loanId, idempotencyKey])`.
* **Replay**: Re-submitting an identical key returns `200 OK` with `replayed: true` and the original payment allocation details.

---

## 5. API Reference

All route handlers return standard JSON envelopes:
* Success: `{ "data": { ... } }`
* Error: `{ "error": { "code": "ERROR_CODE", "message": "..." } }`

### 1. Create a Loan
`POST /api/loans`  
Header: `Authorization: Bearer <token>`
```json
// Request Body
{
  "principal": 200000,
  "annualRate": 18,
  "tenureMonths": 24,
  "disbursementDate": "2026-01-01"
}

// Response (201 Created)
{
  "data": {
    "id": "uuid-v4",
    "principal": "200000.00",
    "annualRate": 18,
    "tenureMonths": 24,
    "disbursementDate": "2026-01-01",
    "emi": "9986.00",
    "excessAmount": "0.00",
    "schedule": [ ... ],
    "position": { ... }
  }
}
```

### 2. Get Loan & Position
`GET /api/loans/[id]?asOf=YYYY-MM-DD`  
Header: `Authorization: Bearer <token>`
```json
// Response (200 OK)
{
  "data": {
    "id": "uuid-v4",
    "schedule": [
      {
        "id": "inst-uuid",
        "seq": 1,
        "dueDate": "2026-02-01",
        "principalComponent": "6986.00",
        "interestComponent": "3000.00",
        "totalDue": "9986.00",
        "paidAmount": "0.00"
      }
    ],
    "position": {
      "outstandingPrincipal": "200000.00",
      "nextDueDate": "2026-02-01",
      "nextDueAmount": "9986.00",
      "overdueAmount": "0.00",
      "daysPastDue": 0,
      "advanceCredit": "0.00"
    }
  }
}
```

### 3. Record a Payment
`POST /api/loans/[id]/payments`  
Header: `Authorization: Bearer <token>`
```json
// Request Body
{
  "amount": "9986.00",
  "paidOn": "2026-02-01",
  "idempotencyKey": "unique-client-uuid-123"
}

// Response (201 Created)
{
  "data": {
    "payment": {
      "id": "payment-uuid",
      "amount": "9986.00",
      "paidOn": "2026-02-01",
      "idempotencyKey": "unique-client-uuid-123"
    },
    "allocations": [
      {
        "instalmentId": "inst-uuid",
        "interestPaid": "3000.00",
        "principalPaid": "6986.00"
      }
    ],
    "excessAllocated": "0.00",
    "position": { ... }
  }
}
```

---

## Error Codes Table

| Code | Status | Trigger Condition |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing or invalid `Authorization: Bearer <token>` header. |
| `VALIDATION_ERROR` | 400 | Invalid payload parameters (e.g. negative amount, tenure > 36). |
| `LOAN_NOT_FOUND` | 404 | Specified loan ID does not exist in database. |
| `INTERNAL_SERVER_ERROR` | 500 | Unhandled database or system exception. |
