import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'QuantDesk — investment research, made precise',
  description: 'Paper portfolios, transparent market data and thoughtful risk analysis.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
