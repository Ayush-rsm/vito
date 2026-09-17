'use client';

import { useState, useEffect } from 'react';
import { auth, signInWithGoogle, logOut } from '@/lib/auth/firebaseClient';
import { onAuthStateChanged, User } from 'firebase/auth';

const DEFAULT_LOAN_ID = '00000000-0000-0000-0000-000000000001';

interface ScheduleItem {
  id: string;
  seq: number;
  dueDate: string;
  principalComponent: string;
  interestComponent: string;
  totalDue: string;
  paidAmount: string;
}

interface PositionData {
  outstandingPrincipal: string;
  nextDueDate: string | null;
  nextDueAmount: string;
  overdueAmount: string;
  daysPastDue: number;
  advanceCredit: string;
}

interface LoanData {
  id: string;
  principal: string;
  annualRate: number;
  tenureMonths: number;
  disbursementDate: string;
  emi: string;
  excessAmount: string;
  schedule: ScheduleItem[];
  position: PositionData;
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [loanId, setLoanId] = useState(DEFAULT_LOAN_ID);
  const [loan, setLoan] = useState<LoanData | null>(null);
  const [loadingLoan, setLoadingLoan] = useState(false);

  const [asOfDate, setAsOfDate] = useState<string>('');

  // Payment Form State
  const [paymentAmount, setPaymentAmount] = useState<string>('9986.00');
  const [paidOnDate, setPaidOnDate] = useState<string>('2026-03-01');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Status messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // Set client-side dates and idempotency key on mount
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setPaidOnDate(today);
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      setIdempotencyKey(window.crypto.randomUUID());
    } else {
      setIdempotencyKey(`idempotency-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    }
  }, []);

  const getAuthToken = async (): Promise<string> => {
    if (user) {
      return await user.getIdToken();
    }
    throw new Error('User is not authenticated');
  };

  const fetchLoan = async (id: string, asOf?: string) => {
    setLoadingLoan(true);
    setErrorMsg(null);
    try {
      const token = await getAuthToken();
      let url = `/api/loans/${id}`;
      if (asOf) url += `?asOf=${asOf}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to fetch loan');
      }

      setLoan(json.data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error loading loan details');
      setLoan(null);
    } finally {
      setLoadingLoan(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchLoan(loanId, asOfDate);
    }
  }, [user, loanId, asOfDate]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmittingPayment(true);

    try {
      const token = await getAuthToken();
      const res = await fetch(`/api/loans/${loanId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: paymentAmount,
          paidOn: paidOnDate,
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Payment recording failed');
      }

      if (json.data.replayed) {
        setSuccessMsg(`Payment already processed (Idempotent replay): ₹${json.data.payment.amount}`);
      } else {
        setSuccessMsg(`Payment of ₹${json.data.payment.amount} successfully recorded and allocated!`);
      }

      // Generate a new idempotency key for subsequent payments
      if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        setIdempotencyKey(window.crypto.randomUUID());
      } else {
        setIdempotencyKey(`idempotency-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
      }

      // Live refresh loan data without full page reload
      await fetchLoan(loanId, asOfDate);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error recording payment');
    } finally {
      setSubmittingPayment(false);
    }
  };

  if (loadingAuth) {
    return (
      <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading authentication state...</p>
      </div>
    );
  }

  const isAuthenticated = !!user;

  return (
    <div className="container">
      {/* Header Bar */}
      <header className="header">
        <div className="title-section">
          <h1>
            Vitto Repayment Service <span className="badge">MSME Lending</span>
          </h1>
          <p>Schedule Generation, Payment Allocation & Real-time Loan Position</p>
        </div>

        <div className="user-bar">
          {isAuthenticated ? (
            <>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                {user.email}
              </span>
              <button
                className="btn btn-secondary"
                onClick={() => logOut()}
              >
                Sign Out
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => signInWithGoogle()}>
              Sign In with Google
            </button>
          )}
        </div>
      </header>

      {!isAuthenticated ? (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <h2 style={{ marginBottom: '1rem', color: '#ffffff' }}>Authentication Required</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
            Please sign in using Firebase Authentication to access loan repayment schedules and record payments.
          </p>
          <button className="btn" onClick={() => signInWithGoogle()}>
            Sign In with Google
          </button>
        </div>
      ) : (
        <>
          {/* Messages */}
          {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
          {successMsg && <div className="alert alert-success">{successMsg}</div>}

          {/* Loan Picker & Time-Travel Controls */}
          <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.5rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: '1 1 300px' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  Loan Identifier:
                </label>
                <input
                  type="text"
                  className="form-control"
                  value={loanId}
                  onChange={(e) => setLoanId(e.target.value)}
                  placeholder="Enter Loan UUID"
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  As-Of Date (Time-Travel):
                </label>
                <input
                  type="date"
                  className="form-control"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  style={{ width: '160px' }}
                />
                {asOfDate && (
                  <button className="btn btn-secondary" onClick={() => setAsOfDate('')}>
                    Reset Date
                  </button>
                )}
              </div>
            </div>
          </div>

          {loadingLoan ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ color: 'var(--text-muted)' }}>Loading loan repayment details...</p>
            </div>
          ) : loan ? (
            <>
              {/* Main Grid: Position Dashboard + Payment Form */}
              <div className="grid-layout">
                {/* Position Dashboard Card */}
                <div className="card">
                  <div className="card-title">
                    <span>Current Position & Summary</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Tenure: {loan.tenureMonths}m @ {loan.annualRate}% p.a.
                    </span>
                  </div>

                  <div className="position-grid">
                    <div className="position-stat">
                      <div className="stat-label">Outstanding Principal</div>
                      <div className="stat-value">₹{loan.position.outstandingPrincipal}</div>
                    </div>

                    <div className="position-stat">
                      <div className="stat-label">Next Due Date</div>
                      <div className="stat-value">{loan.position.nextDueDate || 'Fully Paid'}</div>
                    </div>

                    <div className="position-stat">
                      <div className="stat-label">Next Instalment Due</div>
                      <div className="stat-value">₹{loan.position.nextDueAmount}</div>
                    </div>

                    <div className="position-stat">
                      <div className="stat-label">Overdue Amount</div>
                      <div className={`stat-value ${parseFloat(loan.position.overdueAmount) > 0 ? 'highlight-overdue' : ''}`}>
                        ₹{loan.position.overdueAmount}
                      </div>
                    </div>

                    <div className="position-stat">
                      <div className="stat-label">Days Past Due (DPD)</div>
                      <div className={`stat-value ${loan.position.daysPastDue > 0 ? 'highlight-overdue' : ''}`}>
                        {loan.position.daysPastDue} {loan.position.daysPastDue === 1 ? 'day' : 'days'}
                      </div>
                    </div>

                    <div className="position-stat">
                      <div className="stat-label">Advance / Credit</div>
                      <div className={`stat-value ${parseFloat(loan.position.advanceCredit) > 0 ? 'highlight-excess' : ''}`}>
                        ₹{loan.position.advanceCredit}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Record Payment Form */}
                <div className="card">
                  <div className="card-title">Record Payment</div>
                  <form onSubmit={handleRecordPayment}>
                    <div className="form-group">
                      <label>Payment Amount (₹)</label>
                      <input
                        type="text"
                        className="form-control"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="e.g. 9986.00"
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Payment Date</label>
                      <input
                        type="date"
                        className="form-control"
                        value={paidOnDate}
                        onChange={(e) => setPaidOnDate(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Idempotency Key</label>
                      <input
                        type="text"
                        className="form-control"
                        value={idempotencyKey}
                        onChange={(e) => setIdempotencyKey(e.target.value)}
                        style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn"
                      disabled={submittingPayment}
                      style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
                    >
                      {submittingPayment ? 'Allocating Payment...' : 'Submit Payment'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Schedule Table */}
              <div className="card">
                <div className="card-title">
                  <span>Repayment Schedule</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Monthly EMI: ₹{loan.emi}
                  </span>
                </div>

                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Due Date</th>
                        <th>Principal Component</th>
                        <th>Interest Component</th>
                        <th>Total Due</th>
                        <th>Amount Paid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loan.schedule.map((row) => {
                        const totalDueNum = parseFloat(row.totalDue);
                        const paidNum = parseFloat(row.paidAmount);
                        const isFullyPaid = paidNum >= totalDueNum;
                        const isPartial = paidNum > 0 && paidNum < totalDueNum;

                        const rowDueDate = new Date(row.dueDate);
                        const compDate = asOfDate ? new Date(asOfDate) : new Date();
                        const isOverdue = !isFullyPaid && rowDueDate < compDate;

                        return (
                          <tr key={row.id} className={isOverdue ? 'overdue-row' : ''}>
                            <td style={{ fontWeight: 600 }}>{row.seq}</td>
                            <td>{row.dueDate}</td>
                            <td>₹{row.principalComponent}</td>
                            <td>₹{row.interestComponent}</td>
                            <td style={{ fontWeight: 600 }}>₹{row.totalDue}</td>
                            <td>₹{row.paidAmount}</td>
                            <td>
                              {isFullyPaid ? (
                                <span className="status-tag status-paid">PAID</span>
                              ) : isOverdue ? (
                                <span className="status-tag status-overdue">OVERDUE</span>
                              ) : isPartial ? (
                                <span className="status-tag status-partial">PARTIAL</span>
                              ) : (
                                <span className="status-tag status-unpaid">UNPAID</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
