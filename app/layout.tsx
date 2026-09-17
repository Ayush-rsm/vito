import './globals.css';
import { ReactNode } from 'react';

export const metadata = {
  title: 'Vitto Loan Repayment Service',
  description: 'MSME Loan repayment schedule generator and payment allocation service',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

