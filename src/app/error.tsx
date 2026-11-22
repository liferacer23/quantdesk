'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <span className="brand-icon">↗</span>
      <h1>A little interruption.</h1>
      <p>We couldn’t load this view. Your saved records have not been changed.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <Link className="button secondary" href="/">
        Back to QuantDesk
      </Link>
    </main>
  );
}
