import Link from 'next/link';
import { ArrowUpRight, CandlestickChart, ChartNoAxesCombined, ShieldCheck } from 'lucide-react';
import { DemoButton } from '@/components/auth';
export default function Home() {
  return (
    <main className="landing">
      <header>
        <Link prefetch={false} href="/" className="wordmark">
          <span className="brand-icon">Q/</span>QuantDesk
        </Link>
        <nav>
          <Link prefetch={false} href="/sign-in">
            Sign in
          </Link>
          <Link prefetch={false} className="button" href="/register">
            Create a desk <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <section className="hero">
        <div>
          <span className="eyebrow">YOUR RESEARCH. YOUR EDGE.</span>
          <h1>
            A clearer view.
            <br />
            <em>A sharper thesis.</em>
          </h1>
          <p>
            Bring your portfolios, market research and risk into focus. Test ideas with virtual
            capital and see exactly where every number comes from.
          </p>
          <DemoButton />
          <div className="hero-note">
            <ShieldCheck size={14} />
            No signup. Isolated demo. Explicitly simulated data.
          </div>
        </div>
        <div className="hero-terminal">
          <div className="terminal-label">
            <span>CORE GROWTH / PAPER PORTFOLIO</span>
            <span className="tag">SIMULATED</span>
          </div>
          <div className="hero-value">
            Think beyond
            <br />
            <span>the ticker.</span>
          </div>
          <svg viewBox="0 0 560 210" aria-label="Illustrative chart, not market data" role="img">
            <defs>
              <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <stop stopColor="#59dbc5" stopOpacity=".3" />
                <stop offset="1" stopColor="#59dbc5" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0 180L25 165L45 172L70 140L100 145L125 130L150 148L175 112L200 118L230 88L260 98L290 75L315 89L345 55L375 63L400 35L430 48L460 20L490 32L520 10L560 18V210H0Z"
              fill="url(#fade)"
            />
            <path
              d="M0 180L25 165L45 172L70 140L100 145L125 130L150 148L175 112L200 118L230 88L260 98L290 75L315 89L345 55L375 63L400 35L430 48L460 20L490 32L520 10L560 18"
              fill="none"
              stroke="#59dbc5"
              strokeWidth="2"
            />
          </svg>
          <small>ILLUSTRATION · NO LIVE PRICES</small>
          <div className="hero-cells">
            <div>
              <CandlestickChart />
              <strong>Research</strong>
              <span>Daily OHLC + source context</span>
            </div>
            <div>
              <ChartNoAxesCombined />
              <strong>Understand</strong>
              <span>Cash flows, returns + risk</span>
            </div>
          </div>
        </div>
      </section>
      <section className="landing-features">
        <div>
          <span>01 / BUILD A THESIS</span>
          <h2>
            Every position.
            <br />A complete picture.
          </h2>
          <p>
            Track fractional holdings, fees, realized and unrealized P&L. Keep an immutable paper
            ledger behind every calculation.
          </p>
        </div>
        <div>
          <span>02 / QUESTION THE NUMBERS</span>
          <h2>
            Risk deserves
            <br />
            more than a score.
          </h2>
          <p>
            Compare time-weighted returns, volatility, drawdown and benchmarks with explicit
            assumptions and sample counts.
          </p>
        </div>
        <div>
          <span>03 / TEST BEFORE ACTING</span>
          <h2>
            Explore the trade.
            <br />
            Keep the capital.
          </h2>
          <p>
            Simulate target allocations and their costs before changing a paper position. No broker
            connections or real orders.
          </p>
        </div>
      </section>
      <footer>
        QuantDesk <span>RESEARCH WITH INTENTION. PAPER TRADING ONLY.</span>
      </footer>
    </main>
  );
}
