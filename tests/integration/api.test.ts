import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createLoanHandler } from '../../app/api/loans/route';
import { GET as getLoanHandler } from '../../app/api/loans/[id]/route';
import { POST as recordPaymentHandler } from '../../app/api/loans/[id]/payments/route';
import { prisma } from '../../lib/prisma';

describe('Integration Tests — Route Handlers & Database', () => {
  let createdLoanId: string;
  let isDbAvailable = false;
  const testIdempotencyKey = `test-key-${Date.now()}`;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
    }
  });

  afterAll(async () => {
    if (isDbAvailable && createdLoanId) {
      try {
        await prisma.loan.deleteMany({ where: { id: createdLoanId } });
      } catch {}
    }
    if (isDbAvailable) {
      await prisma.$disconnect();
    }
  });

  it('11. Auth failure: rejects GET loan request without Authorization header with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/loans/some-id', {
      method: 'GET',
    });

    const params = Promise.resolve({ id: 'some-id' });
    const res = await getLoanHandler(req, { params });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe('UNAUTHENTICATED');
  });

  it('11b. Validation failure: rejects POST /api/loans with negative principal with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/loans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        principal: -50000,
        annualRate: 18,
        tenureMonths: 24,
        disbursementDate: '2026-01-01',
      }),
    });

    const res = await createLoanHandler(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('9. Success path: POST /api/loans creates loan in real DB when DB is available', async () => {
    if (!isDbAvailable) {
      console.warn('Skipping live DB integration test — DATABASE_URL offline');
      return;
    }

    const payload = {
      principal: 200000,
      annualRate: 18,
      tenureMonths: 24,
      disbursementDate: '2026-01-01',
    };

    const req = new NextRequest('http://localhost:3000/api/loans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(payload),
    });

    const res = await createLoanHandler(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.id).toBeDefined();
    expect(json.data.schedule).toHaveLength(24);
    expect(json.data.position.outstandingPrincipal).toBe('200000.00');

    createdLoanId = json.data.id;
  });

  it('9b. Success path: GET /api/loans/[id] fetches loan and position', async () => {
    if (!isDbAvailable || !createdLoanId) return;

    const req = new NextRequest(`http://localhost:3000/api/loans/${createdLoanId}`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-token',
      },
    });

    const params = Promise.resolve({ id: createdLoanId });
    const res = await getLoanHandler(req, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe(createdLoanId);
  });

  it('12. Success path & Idempotency: POST payment records payment, second call returns 200 replay', async () => {
    if (!isDbAvailable || !createdLoanId) return;

    const paymentPayload = {
      amount: '9986.00',
      paidOn: '2026-02-01',
      idempotencyKey: testIdempotencyKey,
    };

    // First payment request
    const req1 = new NextRequest(`http://localhost:3000/api/loans/${createdLoanId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(paymentPayload),
    });

    const params = Promise.resolve({ id: createdLoanId });
    const res1 = await recordPaymentHandler(req1, { params });
    const json1 = await res1.json();

    expect(res1.status).toBe(201);
    expect(json1.data.payment.amount).toBe('9986.00');

    // Second request with same idempotency key
    const req2 = new NextRequest(`http://localhost:3000/api/loans/${createdLoanId}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(paymentPayload),
    });

    const res2 = await recordPaymentHandler(req2, { params });
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.data.replayed).toBe(true);
  });

  it('10. Failure path: GET unknown loan ID returns 404 LOAN_NOT_FOUND', async () => {
    if (!isDbAvailable) return;

    const unknownId = '00000000-0000-0000-0000-999999999999';
    const req = new NextRequest(`http://localhost:3000/api/loans/${unknownId}`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-token',
      },
    });

    const params = Promise.resolve({ id: unknownId });
    const res = await getLoanHandler(req, { params });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.code).toBe('LOAN_NOT_FOUND');
  });
});
