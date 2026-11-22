'use client';
import Link from 'next/link';
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  CandlestickChart,
  Star,
  Activity,
  SlidersHorizontal,
  History,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownUp,
  Download,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
  Command,
  ChevronRight,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { Data, ActionResult } from '@/lib/service';
import { Modal, Empty, Section, money } from './ui';
import { request } from './auth';
import { Performance, Candles } from './charts';
const nav = [
  ['portfolio', 'Portfolio', LayoutDashboard],
  ['markets', 'Markets', CandlestickChart],
  ['watchlists', 'Watchlists', Star],
  ['risk', 'Risk & performance', Activity],
  ['rebalance', 'Rebalance', SlidersHorizontal],
  ['activity', 'Trade ledger', History],
  ['settings', 'Desk settings', Settings],
] as const;
const pct = (n: number | null | undefined) =>
  n == null ? 'Unavailable' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const cash = (n: string | number | null | undefined) => (n == null ? 'Unavailable' : money(n));
const numeric = (n: number | null | undefined) => (n == null ? 'Unavailable' : n.toFixed(2));
const formData = (e: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
type ModalState = {
  type: 'portfolio' | 'trade' | 'cash' | 'watchlist' | 'delete' | 'reset';
  symbol?: string;
  id?: string;
  name?: string;
};
export function Terminal({ initial, view }: { initial: Data; view: string }) {
  const [data, setData] = useState(initial),
    [portfolioId, setPortfolioId] = useState(initial.portfolio?.id || ''),
    [range, setRange] = useState(180),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [modal, setModal] = useState<ModalState | null>(null),
    [menu, setMenu] = useState(false),
    [command, setCommand] = useState(false),
    [theme, setTheme] = useState('dark'),
    [symbol, setSymbol] = useState('AAPL'),
    [search, setSearch] = useState(''),
    [sector, setSector] = useState('all'),
    [sort, setSort] = useState('symbol'),
    [page, setPage] = useState(1),
    [tradePage, setTradePage] = useState(1),
    [weights, setWeights] = useState(() =>
      JSON.stringify(initial.portfolio?.targetWeights || { SPY: 70, CASH: 30 }, null, 2),
    ),
    [simulation, setSimulation] = useState<ActionResult['simulation']>(),
    [key, setKey] = useState(() => crypto.randomUUID());
  const weightValues: Record<string, number> = JSON.parse(weights);
  const changeWeight = (symbol: string, value: number) => {
    setWeights(JSON.stringify({ ...weightValues, [symbol]: value }));
    setSimulation(undefined);
  };
  const router = useRouter();
  const load = useCallback(
    async (id = portfolioId, days = range) => {
      setLoading(true);
      try {
        const d = await request<Data>(`/api/data?range=${days}${id ? `&portfolio=${id}` : ''}`);
        setData(d);
        setPortfolioId(d.portfolio?.id || '');
        window.history.replaceState(
          null,
          '',
          `/app/${view}${d.portfolio ? `?portfolio=${d.portfolio.id}` : ''}`,
        );
        return d;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load desk.');
      } finally {
        setLoading(false);
      }
    },
    [portfolioId, range, view],
  );
  useEffect(() => {
    const stored = localStorage.getItem('quantdesk-theme');
    if (stored === 'light') document.documentElement.dataset.theme = 'light';
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommand((c) => !c);
      }
      if (e.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const act = async (
    body: Record<string, unknown>,
    options: { close?: boolean; selectCreated?: boolean } = {},
  ) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await request<ActionResult>('/api/actions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const id = options.selectCreated
        ? r.id || ''
        : body.action === 'demo.reset' || body.action === 'portfolio.delete'
          ? ''
          : portfolioId;
      const d = await load(id);
      if (d && options.selectCreated)
        setWeights(JSON.stringify(d.portfolio?.targetWeights || { SPY: 70, CASH: 30 }, null, 2));
      setNotice(r.message);
      if (options.close) setModal(null);
      if (r.simulation) setSimulation(r.simulation);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      setBusy(false);
    }
  };
  const open = (m: ModalState) => {
    setError('');
    setModal(m);
    setKey(crypto.randomUUID());
  };
  const source = data.source === 'SIMULATED' ? 'Simulated data' : 'Alpha Vantage · EOD';
  const portfolio = data.portfolio,
    summary = data.summary;
  const quotes = data.quotes
    .filter(
      (q) =>
        (q.symbol + ' ' + q.name).toLowerCase().includes(search.toLowerCase()) &&
        (sector === 'all' || q.sector === sector),
    )
    .sort((a, b) =>
      sort === 'price'
        ? Number(b.close) - Number(a.close)
        : sort === 'change'
          ? (b.changePct || 0) - (a.changePct || 0)
          : a.symbol.localeCompare(b.symbol),
    );
  const selectedQuote = data.quotes.find((q) => q.symbol === symbol),
    selectedList = data.watchlists.find((w) => w.id === search) || data.watchlists[0];
  const choosePortfolio = async (id: string) => {
    setPortfolioId(id);
    setSimulation(undefined);
    const d = await load(id);
    if (d) setWeights(JSON.stringify(d.portfolio?.targetWeights || { SPY: 70, CASH: 30 }, null, 2));
  };
  const title = nav.find((n) => n[0] === view)?.[1] || 'Portfolio';
  return (
    <div className="desk">
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Link prefetch={false} href="/" className="wordmark">
            <span className="brand-icon">Q/</span>QuantDesk
          </Link>
          <button
            className="icon-button mobile-only"
            onClick={() => setMenu(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-avatar">QD</span>
          <div>
            <strong>{data.workspace.demo ? 'Research sandbox' : 'Private research desk'}</strong>
            <small>{data.workspace.demo ? 'ISOLATED DEMO' : 'PERSONAL WORKSPACE'}</small>
          </div>
        </div>
        <button className="command-trigger" onClick={() => setCommand(true)}>
          <Search size={15} />
          Jump to…<kbd>⌘ K</kbd>
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {nav.map(([path, label, Icon]) => (
            <Link
              prefetch={false}
              key={path}
              href={`/app/${path}${portfolioId ? `?portfolio=${portfolioId}` : ''}`}
              className={view === path ? 'active' : ''}
              onClick={() => setMenu(false)}
            >
              <Icon size={17} />
              {label}
              {view === path && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="paper-only">
            <span className="status-dot" />
            <strong>Paper trading only</strong>
            <p>Virtual funds. No real orders.</p>
          </div>
          <button className="profile-button" onClick={() => router.push('/app/settings')}>
            <span className="avatar">{data.workspace.demo ? 'D' : 'P'}</span>
            <div>
              <strong>{data.workspace.demo ? 'Demo researcher' : 'Your desk'}</strong>
              <small>USD base currency</small>
            </div>
            <Settings size={15} />
          </button>
        </div>
      </aside>
      {menu && (
        <button
          aria-label="Dismiss navigation"
          className="menu-scrim"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="desk-main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={13} />
              <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className={`tag ${data.source === 'SIMULATED' ? 'amber' : ''}`}>{source}</span>
            <button
              className="icon-button"
              aria-label="Toggle theme"
              onClick={() => {
                const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
                setTheme(next);
                document.documentElement.dataset.theme = next;
                localStorage.setItem('quantdesk-theme', next);
              }}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await request('/api/auth/logout', { method: 'POST', body: '{}' });
                  router.push('/');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Unable to sign out.');
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="content" aria-busy={loading}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {view === 'portfolio'
                  ? 'CAPITAL, IN CONTEXT'
                  : view === 'markets'
                    ? 'RESEARCH DESK'
                    : 'YOUR INVESTMENT WORKSPACE'}
              </span>
              <h1>{view === 'portfolio' ? 'Portfolio overview' : title}</h1>
              <p>
                {view === 'portfolio'
                  ? 'The whole picture. Every position, every decision.'
                  : view === 'markets'
                    ? 'Daily observations with their source and timestamp attached.'
                    : view === 'risk'
                      ? 'Understand how your paper capital behaves.'
                      : view === 'rebalance'
                        ? 'Explore a target allocation before changing a position.'
                        : view === 'activity'
                          ? 'Immutable paper fills. Transparent accounting.'
                          : view === 'watchlists'
                            ? 'Keep the ideas worth following close.'
                            : 'Tune your workspace and portfolio assumptions.'}
              </p>
            </div>
            <div className="heading-actions">
              {view === 'portfolio' && (
                <>
                  <button
                    className="button"
                    onClick={() => open({ type: 'cash' })}
                    disabled={!portfolio}
                  >
                    <ArrowDownUp size={15} />
                    Move cash
                  </button>
                  <button
                    className="button primary"
                    onClick={() => open({ type: 'trade', symbol })}
                    disabled={!portfolio}
                  >
                    <Plus size={16} />
                    Paper order
                  </button>
                </>
              )}
              {view === 'watchlists' && (
                <button className="button primary" onClick={() => open({ type: 'watchlist' })}>
                  <Plus size={16} />
                  New watchlist
                </button>
              )}
              {view === 'activity' && portfolio && (
                <a className="button" href={`/api/report?portfolio=${portfolio.id}`}>
                  <Download size={15} />
                  Export report
                </a>
              )}
            </div>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice success" role="status">
              {notice}
            </div>
          )}
          {data.workspace.demo && (
            <div className="demo-bar">
              <span>
                <span className="status-dot" />
                You’re exploring an isolated demo. Prices and portfolios are synthetic.
              </span>
              <button disabled={busy} onClick={() => open({ type: 'reset' })}>
                Reset demo <RefreshCw size={12} />
              </button>
            </div>
          )}
          <div className="desk-controls">
            <label>
              Portfolio
              <select
                aria-label="Selected portfolio"
                value={portfolioId}
                onChange={(e) => void choosePortfolio(e.target.value)}
              >
                {!portfolio && <option value="">Select a portfolio</option>}
                {data.portfolios.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="text-button" onClick={() => open({ type: 'portfolio' })}>
              <Plus size={14} />
              New portfolio
            </button>
            <span className="data-context">
              {source} · USD · {data.quotes[0]?.date || 'No observations'}
            </span>
          </div>
          {data.truncated && (
            <p className="notice error">
              Historical analysis exceeds the interactive limit. History and total contribution
              metrics are unavailable; current positions remain visible.
            </p>
          )}
          {data.unpricedSymbols.length > 0 && (
            <p className="notice error">
              Unpriced holdings: {data.unpricedSymbols.join(', ')}. Total equity is unavailable.
            </p>
          )}
          {view === 'portfolio' &&
            (!portfolio ? (
              <Empty
                title="A fresh research desk"
                text="Create a paper portfolio with virtual capital. Then build positions using clearly labeled simulated prices."
              >
                <button className="button primary" onClick={() => open({ type: 'portfolio' })}>
                  Create paper portfolio
                </button>
              </Empty>
            ) : (
              <>
                <div className="stats-grid">
                  <Metric
                    label="TOTAL EQUITY"
                    value={cash(summary?.equity)}
                    detail={`Cash ${cash(summary?.cash)} · USD`}
                    primary
                  />
                  <Metric
                    label="NET PROFIT / LOSS"
                    value={cash(summary?.netPnl)}
                    detail="Equity less net contributions"
                    positive={Number(summary?.netPnl) >= 0}
                  />
                  <Metric
                    label="PERIOD RETURN · TWR"
                    value={pct(summary?.periodReturn)}
                    detail={`${range}D window · Benchmark ${pct(summary?.benchmarkReturn)}`}
                    positive={(summary?.periodReturn || 0) >= 0}
                  />
                  <Metric
                    label="BUYING POWER"
                    value={cash(summary?.cash)}
                    detail={`${summary?.tradeCount || 0} paper fills · ${data.positions.length} holdings`}
                  />
                </div>
                <Section
                  title="Performance"
                  description="Time-weighted returns · indexed to 100 · price-only benchmark"
                  action={
                    <div className="segmented">
                      {[30, 90, 180, 365].map((n) => (
                        <button
                          key={n}
                          className={range === n ? 'active' : ''}
                          onClick={() => {
                            setRange(n);
                            void load(portfolioId, n);
                          }}
                        >
                          {n === 365 ? '1Y' : `${n}D`}
                        </button>
                      ))}
                    </div>
                  }
                >
                  {data.history.length > 1 ? (
                    <Performance data={data.history} />
                  ) : (
                    <Empty
                      title="Your history starts here"
                      text="Daily valuations appear as your paper ledger develops."
                    />
                  )}
                  <div className="chart-footer">
                    <span>Portfolio includes uninvested cash and fees.</span>
                    <Link prefetch={false} href={`/app/risk?portfolio=${portfolioId}`}>
                      Explore risk <ArrowUpRight size={13} />
                    </Link>
                  </div>
                </Section>
                <div className="portfolio-grid">
                  <Section
                    title="Holdings"
                    description="Average cost basis includes buy fees"
                    action={
                      <button
                        className="text-button"
                        onClick={() => open({ type: 'trade', symbol })}
                      >
                        Trade <Plus size={14} />
                      </button>
                    }
                  >
                    <Holdings data={data} onTrade={(s) => open({ type: 'trade', symbol: s })} />
                  </Section>
                  <Section title="Capital allocation" description="Current equity, including cash">
                    <div className="allocation">
                      {[
                        ...data.positions.map((h) => ({
                          symbol: h.symbol,
                          value: h.value,
                          weight: h.weight,
                        })),
                        {
                          symbol: 'CASH',
                          value: summary?.cash,
                          weight:
                            summary?.equity && Number(summary.equity) > 0
                              ? (Number(summary.cash) / Number(summary.equity)) * 100
                              : 0,
                        },
                      ].map((h, i) => (
                        <div key={h.symbol}>
                          <div className="allocation-label">
                            <strong>
                              <span
                                className="swatch"
                                style={{
                                  background: [
                                    '#59dbc5',
                                    '#8fa5ef',
                                    '#efb36b',
                                    '#c596e8',
                                    '#8994a6',
                                  ][i % 5],
                                }}
                              />
                              {h.symbol}
                            </strong>
                            <span>{h.weight?.toFixed(1) || '—'}%</span>
                          </div>
                          <div className="allocation-track">
                            <span
                              style={{
                                width: `${h.weight || 0}%`,
                                background: ['#59dbc5', '#8fa5ef', '#efb36b', '#c596e8', '#8994a6'][
                                  i % 5
                                ],
                              }}
                            />
                          </div>
                          <small>{cash(h.value)}</small>
                        </div>
                      ))}
                    </div>
                    <Link
                      prefetch={false}
                      href={`/app/rebalance?portfolio=${portfolioId}`}
                      className="button full"
                    >
                      Explore rebalancing <ArrowUpRight size={14} />
                    </Link>
                  </Section>
                </div>
                <div className="desk-footnote">
                  {source} · Observations are daily closes, not executable market quotes. Paper
                  fills use the most recent close, never a live exchange price.
                </div>
              </>
            ))}
          {view === 'markets' && (
            <>
              <Section
                title="Market explorer"
                description="Search the covered universe. No prices are presented as live."
                action={<span className="tag">DAILY / OHLC</span>}
              >
                <div className="filter-bar">
                  <label className="search-field">
                    <Search size={15} />
                    <input
                      aria-label="Search markets"
                      placeholder="Search ticker or company…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <select
                    aria-label="Filter sector"
                    value={sector}
                    onChange={(e) => {
                      setSector(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">All sectors</option>
                    {[...new Set(data.quotes.map((q) => q.sector))].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Sort markets"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="symbol">Symbol A–Z</option>
                    <option value="price">Price: high to low</option>
                    <option value="change">Daily change</option>
                  </select>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Instrument</th>
                        <th>Last close</th>
                        <th>Daily change</th>
                        <th>Sector</th>
                        <th>As of / UTC date</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.slice((page - 1) * 8, page * 8).map((q) => (
                        <tr key={q.symbol} className={symbol === q.symbol ? 'selected-row' : ''}>
                          <td>
                            <button className="instrument" onClick={() => setSymbol(q.symbol)}>
                              <span className="ticker-avatar">{q.symbol.slice(0, 2)}</span>
                              <span>
                                <strong>{q.symbol}</strong>
                                <small>{q.name}</small>
                              </span>
                            </button>
                          </td>
                          <td>{cash(q.close)}</td>
                          <td className={(q.changePct || 0) >= 0 ? 'positive' : 'negative'}>
                            {pct(q.changePct)}
                          </td>
                          <td>{q.sector}</td>
                          <td>
                            {q.date}
                            {q.stale && <span className="tag amber">STALE</span>}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              disabled={!portfolio}
                              onClick={() => open({ type: 'trade', symbol: q.symbol })}
                            >
                              Paper trade <ArrowUpRight size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!quotes.length && (
                  <Empty
                    title="No matching observations"
                    text="Try another ticker, clear your filters, or refresh your configured provider in settings."
                  />
                )}
                <div className="pagination">
                  <span>{quotes.length} instruments</span>
                  <button
                    className="button small"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <span>{page}</span>
                  <button
                    className="button small"
                    disabled={page * 8 >= quotes.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </Section>
              <Section
                title={`${symbol} / daily candles`}
                description={`${source} · ${selectedQuote ? `Last close ${cash(selectedQuote.close)} · ${selectedQuote.date}` : 'Observations unavailable'}`}
                action={
                  <select
                    aria-label="Chart symbol"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                  >
                    {[...new Set([symbol, ...data.quotes.map((q) => q.symbol)])].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                }
              >
                <Candles
                  key={`${portfolioId}-${symbol}`}
                  symbol={symbol}
                  portfolio={portfolioId || undefined}
                />
              </Section>
            </>
          )}
          {view === 'watchlists' && (
            <div className="watchlist-layout">
              <section className="panel watchlist-picker">
                <h2>Your watchlists</h2>
                {data.watchlists.map((w) => (
                  <button
                    key={w.id}
                    className={selectedList?.id === w.id ? 'active' : ''}
                    onClick={() => setSearch(w.id)}
                  >
                    <Star size={15} />
                    <span>
                      {w.name}
                      <small>{w.symbols.length} symbols</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
                {!data.watchlists.length && (
                  <p className="muted">Create a watchlist to save research ideas.</p>
                )}
              </section>
              {selectedList ? (
                <Section
                  title={selectedList.name}
                  description={`${source} · prices may be unavailable for uncovered symbols`}
                  action={
                    <button
                      aria-label="Delete watchlist"
                      className="icon-button"
                      onClick={() =>
                        open({ type: 'delete', id: selectedList.id, name: selectedList.name })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  }
                >
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = formData(e);
                      void act({ action: 'watchlist.add', id: selectedList.id, symbol: f.symbol });
                      e.currentTarget.reset();
                    }}
                  >
                    <label>
                      Add ticker
                      <input
                        aria-label="Watchlist ticker"
                        name="symbol"
                        placeholder="e.g. AAPL"
                        required
                        pattern="[A-Za-z][A-Za-z0-9.\-]{0,11}"
                        maxLength={12}
                      />
                    </label>
                    <button className="button primary" disabled={busy}>
                      Add symbol
                    </button>
                  </form>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Daily close</th>
                          <th>Change</th>
                          <th>As of</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedList.symbols.map((s) => {
                          const q = data.quotes.find((q) => q.symbol === s);
                          return (
                            <tr key={s}>
                              <td>
                                <strong>{s}</strong>
                              </td>
                              <td>{cash(q?.close)}</td>
                              <td>{pct(q?.changePct)}</td>
                              <td>{q?.date || 'No observation'}</td>
                              <td>
                                <button
                                  className="icon-button"
                                  disabled={busy}
                                  aria-label={`Remove ${s}`}
                                  onClick={() =>
                                    void act({
                                      action: 'watchlist.remove',
                                      id: selectedList.id,
                                      symbol: s,
                                    })
                                  }
                                >
                                  <X size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!selectedList.symbols.length && (
                    <Empty
                      title="Room for your next idea"
                      text="Add a ticker to start tracking its daily observations."
                    />
                  )}
                </Section>
              ) : (
                <Empty
                  title="Keep a research shortlist"
                  text="Save symbols in separate watchlists for different strategies."
                />
              )}
            </div>
          )}
          {view === 'risk' &&
            (!portfolio ? (
              <Empty
                title="Select a portfolio"
                text="Create a portfolio to evaluate returns and risk."
              />
            ) : (
              <>
                <div className="risk-header">
                  <span className="tag">{range}D WINDOW</span>
                  <div className="segmented">
                    {[30, 90, 180, 365].map((n) => (
                      <button
                        key={n}
                        className={range === n ? 'active' : ''}
                        onClick={() => {
                          setRange(n);
                          void load(portfolioId, n);
                        }}
                      >
                        {n === 365 ? '1Y' : `${n}D`}
                      </button>
                    ))}
                  </div>
                  <span className="muted">{data.risk.samples} daily return observations</span>
                </div>
                <div className="stats-grid">
                  <Metric
                    label="ANNUALIZED VOLATILITY"
                    value={
                      data.risk.volatility == null
                        ? 'Unavailable'
                        : `${(data.risk.volatility * 100).toFixed(2)}%`
                    }
                    detail="Sample standard deviation × √252"
                  />
                  <Metric
                    label="SHARPE RATIO"
                    value={numeric(data.risk.sharpe)}
                    detail={`Risk-free ${(portfolio.riskFreeRate * 100).toFixed(2)}% annual`}
                  />
                  <Metric
                    label="MAXIMUM DRAWDOWN"
                    value={pct(data.risk.maxDrawdown)}
                    detail="Peak-to-trough · selected window"
                  />
                  <Metric
                    label="TIME-WEIGHTED RETURN"
                    value={pct(summary?.periodReturn)}
                    detail={`${portfolio.benchmark} ${pct(summary?.benchmarkReturn)}`}
                  />
                </div>
                <Section
                  title="Underwater curve"
                  description="Decline from the previous portfolio return peak"
                >
                  <Performance data={data.history} drawdown />
                </Section>
                <div className="portfolio-grid">
                  <Section
                    title="Return comparison"
                    description="Normalized to 100 at window start"
                  >
                    <Performance data={data.history} />
                  </Section>
                  <Section title="Methodology & assumptions">
                    <dl className="method-list">
                      <dt>Data source</dt>
                      <dd>{source}</dd>
                      <dt>Benchmark</dt>
                      <dd>{portfolio.benchmark} · price only</dd>
                      <dt>Sampling</dt>
                      <dd>Daily observations · 252 periods/year</dd>
                      <dt>External flows</dt>
                      <dd>Deposits / withdrawals treated as end-of-day flows.</dd>
                      <dt>Accounting</dt>
                      <dd>Average cost basis; fees included. Cash dilutes returns.</dd>
                      <dt>Unavailable data</dt>
                      <dd>{summary?.valuationGaps || 0} valuation gaps. No fabricated zeroes.</dd>
                    </dl>
                    <p className="muted">
                      Price-only analysis excludes dividends, splits, taxes and corporate actions.
                      Small samples and zero volatility yield unavailable risk values. Returns are
                      retrospective, never forecasts.
                    </p>
                  </Section>
                </div>
                <Section title="Accessible performance data" description="Latest 20 valuations">
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Equity</th>
                          <th>Portfolio index</th>
                          <th>Benchmark index</th>
                          <th>Return</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.history
                          .slice(-20)
                          .reverse()
                          .map((h) => (
                            <tr key={h.date}>
                              <td>{h.date}</td>
                              <td>{cash(h.equity)}</td>
                              <td>{numeric(h.index)}</td>
                              <td>{numeric(h.benchmarkIndex)}</td>
                              <td>{pct(h.dailyReturn)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </>
            ))}
          {view === 'rebalance' &&
            (!portfolio ? (
              <Empty
                title="Create a portfolio first"
                text="A funded, priced portfolio is needed for the simulator."
              />
            ) : (
              <div className="rebalance-grid">
                <Section
                  title="Design a target allocation"
                  description="Weights must total 100%, including CASH"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      try {
                        const parsed = JSON.parse(weights) as unknown;
                        void act({
                          action: 'rebalance.simulate',
                          portfolioId,
                          weights: parsed,
                          fee: new FormData(e.currentTarget).get('fee'),
                        });
                      } catch {
                        setError('Review the target allocation.');
                      }
                    }}
                  >
                    <div className="weight-editor">
                      <span className="muted">
                        Target allocation ·{' '}
                        {Object.values(weightValues)
                          .reduce((a, b) => a + b, 0)
                          .toFixed(1)}
                        % / 100%
                      </span>
                      {[
                        ...new Set([
                          ...data.quotes.map((q) => q.symbol),
                          ...Object.keys(weightValues),
                          'CASH',
                        ]),
                      ]
                        .sort()
                        .map((s) => (
                          <label key={s}>
                            {s}
                            <span>
                              <input
                                aria-label={`${s} target weight`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={weightValues[s] || 0}
                                onChange={(e) => changeWeight(s, Number(e.target.value))}
                              />
                              %
                            </span>
                          </label>
                        ))}
                    </div>
                    <label>
                      Estimated fee per order (USD)
                      <input
                        name="fee"
                        defaultValue="1.00"
                        type="number"
                        min="0"
                        max="9999"
                        step="0.01"
                        required
                      />
                    </label>
                    <button className="button primary" disabled={busy}>
                      Preview rebalance <ArrowUpRight size={15} />
                    </button>
                    <button
                      className="button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        try {
                          void act({
                            action: 'rebalance.save',
                            portfolioId,
                            weights: JSON.parse(weights),
                          });
                        } catch {
                          setError('Review the target allocation.');
                        }
                      }}
                    >
                      Save target weights
                    </button>
                  </form>
                  <p className="notice">
                    This is a paper allocation calculator. Saving targets and previews never submits
                    orders.
                  </p>
                </Section>
                <Section
                  title="Rebalance preview"
                  description="Fractional quantities · current observed closes"
                >
                  {simulation ? (
                    <>
                      <div className="preview-stats">
                        <Metric label="PROJECTED CASH" value={cash(simulation.estimatedCash)} />
                        <Metric label="ESTIMATED FEES" value={cash(simulation.estimatedFees)} />
                      </div>
                      <p className={`notice ${simulation.feasible ? 'success' : 'error'}`}>
                        {simulation.feasible
                          ? 'Plan is funded after estimated fees.'
                          : 'Insufficient cash after fees. Increase the CASH target.'}{' '}
                        · Turnover {(simulation.turnover * 100).toFixed(2)}%
                      </p>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Symbol</th>
                              <th>Current → target</th>
                              <th>Side</th>
                              <th>Shares</th>
                              <th>Notional</th>
                            </tr>
                          </thead>
                          <tbody>
                            {simulation.rows.map((r) => (
                              <tr key={r.symbol}>
                                <td>{r.symbol}</td>
                                <td>
                                  {r.currentWeight.toFixed(1)}% → {r.targetWeight.toFixed(1)}%
                                </td>
                                <td>
                                  <span className="tag">{r.side}</span>
                                </td>
                                <td>{r.quantity}</td>
                                <td>{cash(r.notional)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="Make room for a new perspective"
                      text="Adjust weights and preview the trades, turnover and fees required to reach your target."
                    />
                  )}
                </Section>
              </div>
            ))}
          {view === 'activity' && (
            <>
              <Section
                title="Paper trade ledger"
                description={`Latest ${data.trades.length} of ${summary?.tradeCount || 0} fills · ${source}`}
                action={<span className="tag">IMMUTABLE</span>}
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Executed / UTC</th>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Quantity</th>
                        <th>Fill price</th>
                        <th>Price as of</th>
                        <th>Fee</th>
                        <th>Realized P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trades.slice((tradePage - 1) * 10, tradePage * 10).map((t) => (
                        <tr key={t.id}>
                          <td>{t.executedAt.slice(0, 19).replace('T', ' ')}</td>
                          <td>
                            <strong>{t.symbol}</strong>
                          </td>
                          <td>
                            <span className={`tag ${t.side === 'SELL' ? 'amber' : ''}`}>
                              {t.side}
                            </span>
                          </td>
                          <td>{t.quantity}</td>
                          <td>{cash(t.price)}</td>
                          <td>{t.priceAsOf}</td>
                          <td>{cash(t.fee)}</td>
                          <td>{t.side === 'SELL' ? cash(t.realizedPnl) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.trades.length && (
                  <Empty
                    title="No paper fills yet"
                    text="Place a paper order from your portfolio to begin its ledger."
                  />
                )}
                <div className="pagination">
                  <span>{data.trades.length} recent fills</span>
                  <button
                    className="button small"
                    disabled={tradePage === 1}
                    onClick={() => setTradePage(tradePage - 1)}
                  >
                    Previous
                  </button>
                  <span>{tradePage}</span>
                  <button
                    className="button small"
                    disabled={tradePage * 10 >= data.trades.length}
                    onClick={() => setTradePage(tradePage + 1)}
                  >
                    Next
                  </button>
                </div>
              </Section>
              <div className="portfolio-grid">
                <Section
                  title="Virtual cash movements"
                  description="Latest 50 external deposits and withdrawals"
                >
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date / UTC</th>
                          <th>Kind</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.flows.map((f) => (
                          <tr key={f.id}>
                            <td>{f.executedAt.slice(0, 10)}</td>
                            <td>{f.kind}</td>
                            <td>{cash(f.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
                <Section title="Desk activity" description="Recent audited workspace actions">
                  <div className="timeline">
                    {data.audits.map((a) => (
                      <div key={a.id}>
                        <span className="status-dot" />
                        <div>
                          <strong>{a.action.replaceAll('.', ' / ')}</strong>
                          <p>{a.detail}</p>
                          <small>{new Date(a.createdAt).toLocaleString()}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            </>
          )}
          {view === 'settings' && (
            <div className="settings-grid">
              <Section
                title="Portfolio settings"
                description="The data source is fixed when a portfolio is created"
              >
                {portfolio ? (
                  <form
                    key={portfolio.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = formData(e);
                      void act({
                        action: 'portfolio.update',
                        id: portfolio.id,
                        name: f.name,
                        description: f.description,
                        benchmark: f.benchmark,
                        riskFreeRate: Number(f.riskFreeRate) / 100,
                      });
                    }}
                  >
                    <label>
                      Portfolio name
                      <input
                        name="name"
                        defaultValue={portfolio.name}
                        minLength={2}
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        name="description"
                        defaultValue={portfolio.description}
                        maxLength={500}
                      />
                    </label>
                    <label>
                      Benchmark ticker
                      <input
                        name="benchmark"
                        defaultValue={portfolio.benchmark}
                        required
                        maxLength={12}
                      />
                    </label>
                    <label>
                      Annual risk-free rate (%)
                      <input
                        name="riskFreeRate"
                        type="number"
                        min="0"
                        max="20"
                        step="0.01"
                        defaultValue={(portfolio.riskFreeRate * 100).toFixed(2)}
                        required
                      />
                    </label>
                    <p className="muted">Source: {source} · Base currency: USD</p>
                    <button className="button primary" disabled={busy}>
                      Save portfolio settings
                    </button>
                    <button
                      className="button danger"
                      type="button"
                      onClick={() =>
                        open({ type: 'delete', id: portfolio.id, name: portfolio.name })
                      }
                    >
                      Delete paper portfolio
                    </button>
                  </form>
                ) : (
                  <p>Create a portfolio to configure assumptions.</p>
                )}
              </Section>
              <div>
                <Section
                  title="Market data provider"
                  description="Real daily observations require Alpha Vantage credentials"
                >
                  <span className={`tag ${data.providerConfigured ? '' : 'amber'}`}>
                    {data.providerConfigured ? 'PROVIDER CONFIGURED' : 'PROVIDER UNAVAILABLE'}
                  </span>
                  <p>
                    Simulated portfolios always use fictional seeded prices. Provider portfolios use
                    cached Alpha Vantage daily unadjusted observations, with no silent fallback.
                  </p>
                  <p className="muted">
                    Free-tier request limits are enforced. The provider’s latest observation can be
                    delayed or unavailable. Cached prices keep their original dates after refresh
                    failures.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act({
                        action: 'market.refresh',
                        symbol: formData(e).symbol.toUpperCase(),
                      });
                    }}
                  >
                    <label>
                      Refresh real provider ticker
                      <input name="symbol" defaultValue="SPY" maxLength={12} required />
                    </label>
                    <button
                      className="button"
                      disabled={busy || data.workspace.demo || !data.providerConfigured}
                    >
                      <RefreshCw size={14} />
                      Refresh daily cache
                    </button>
                  </form>
                  {data.workspace.demo && (
                    <small>Real provider requests are disabled in the public demo.</small>
                  )}
                  {data.providerStates
                    .filter((p) => p.error)
                    .slice(0, 5)
                    .map((p) => (
                      <p className="notice error" key={p.symbol}>
                        {p.symbol}: {p.error}
                      </p>
                    ))}
                </Section>
                <Section title="Your research sandbox">
                  <p>
                    {data.workspace.demo
                      ? 'Demo changes are isolated in your temporary workspace. Reset restores the synthetic portfolios and watchlists.'
                      : 'Your private workspace starts empty and retains its own portfolios and watchlists.'}
                  </p>
                  {data.workspace.demo && (
                    <button className="button" onClick={() => open({ type: 'reset' })}>
                      Restore demo dataset
                    </button>
                  )}
                  <p className="muted">
                    Paper trading only. No market advice, broker orders or custody of funds.
                  </p>
                </Section>
              </div>
            </div>
          )}
        </main>
        <footer className="desk-footer">
          <span>QUANTDESK / RESEARCH TERMINAL</span>
          <span>{source} · No real orders</span>
        </footer>
      </div>
      {modal && (
        <Modal
          title={
            modal.type === 'portfolio'
              ? 'Create paper portfolio'
              : modal.type === 'trade'
                ? 'Place a paper order'
                : modal.type === 'cash'
                  ? 'Move virtual cash'
                  : modal.type === 'watchlist'
                    ? 'Create watchlist'
                    : modal.type === 'reset'
                      ? 'Restore demo?'
                      : `Delete ${modal.name}?`
          }
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {modal.type === 'portfolio' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  { action: 'portfolio.create', ...formData(e) },
                  { close: true, selectCreated: true },
                );
              }}
            >
              <label>
                Name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="e.g. Long-term conviction"
                  autoFocus
                />
              </label>
              <label>
                Price source
                <select name="source" defaultValue="SIMULATED">
                  <option value="SIMULATED">Simulated · fictional daily prices</option>
                  <option
                    value="PROVIDER"
                    disabled={!data.providerConfigured || data.workspace.demo}
                  >
                    Alpha Vantage · real EOD (credentials required)
                  </option>
                </select>
                <small>
                  Fixed for the life of this portfolio. Simulated and real cost bases cannot be
                  mixed.
                </small>
              </label>
              <label>
                Starting virtual capital (USD)
                <input
                  name="startingCash"
                  type="number"
                  min="0.01"
                  max="100000000"
                  step="0.01"
                  defaultValue="100000"
                  required
                />
              </label>
              <label>
                Benchmark
                <input name="benchmark" defaultValue="SPY" maxLength={12} required />
              </label>
              <button className="button primary full" disabled={busy}>
                {busy ? 'Creating…' : 'Create portfolio'}
              </button>
            </form>
          )}
          {modal.type === 'trade' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  { action: 'trade.execute', portfolioId, idempotencyKey: key, ...formData(e) },
                  { close: true },
                );
              }}
            >
              <p className="notice">
                {source} · Paper fill at the most recent daily close. No real order or live exchange
                execution.
              </p>
              <label>
                Symbol
                <select name="symbol" defaultValue={modal.symbol || 'AAPL'}>
                  {[...new Set([modal.symbol || 'AAPL', ...data.quotes.map((q) => q.symbol)])].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Side
                <select name="side">
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                </select>
              </label>
              <label>
                Quantity
                <input
                  name="quantity"
                  type="number"
                  min="0.000001"
                  max="1000000"
                  step="0.000001"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Fee (USD)
                <input
                  name="fee"
                  type="number"
                  min="0"
                  max="9999"
                  step="0.01"
                  defaultValue="1.00"
                  required
                />
              </label>
              <p className="muted">
                Buying power {cash(summary?.cash)} · Latest prices and dates remain visible in
                Markets.
              </p>
              <button className="button primary full" disabled={busy}>
                {busy ? 'Recording…' : 'Confirm paper order'}
              </button>
            </form>
          )}
          {modal.type === 'cash' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  { action: 'cash.flow', portfolioId, idempotencyKey: key, ...formData(e) },
                  { close: true },
                );
              }}
            >
              <p>Virtual funds only. Cash movements do not count as investment returns.</p>
              <label>
                Movement
                <select name="kind">
                  <option value="DEPOSIT">Deposit virtual funds</option>
                  <option value="WITHDRAW">Withdraw virtual funds</option>
                </select>
              </label>
              <label>
                Amount (USD)
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  max="100000000"
                  step="0.01"
                  required
                />
              </label>
              <button className="button primary" disabled={busy}>
                Record cash movement
              </button>
            </form>
          )}
          {modal.type === 'watchlist' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: 'watchlist.create', ...formData(e) }, { close: true }).then(
                  (r) => {
                    if (r?.id) setSearch(r.id);
                  },
                );
              }}
            >
              <label>
                Watchlist name
                <input name="name" required minLength={2} maxLength={80} autoFocus />
              </label>
              <button className="button primary" disabled={busy}>
                Create watchlist
              </button>
            </form>
          )}
          {(modal.type === 'delete' || modal.type === 'reset') && (
            <>
              <p>
                {modal.type === 'reset'
                  ? 'This replaces only your isolated demo’s portfolios, ledger and watchlists with the original synthetic dataset.'
                  : 'This permanently removes the selected item and its associated paper records.'}
              </p>
              <div className="dialog-actions">
                <button className="button" disabled={busy} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      modal.type === 'reset'
                        ? { action: 'demo.reset' }
                        : {
                            action: view === 'watchlists' ? 'watchlist.delete' : 'portfolio.delete',
                            id: modal.id,
                          },
                      { close: true },
                    )
                  }
                >
                  {busy
                    ? 'Working…'
                    : modal.type === 'reset'
                      ? 'Restore demo'
                      : 'Delete permanently'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {command && (
        <Modal title="Jump to your desk" onClose={() => setCommand(false)}>
          <div className="command-list">
            {nav.map(([path, label, Icon]) => (
              <Link
                key={path}
                prefetch={false}
                href={`/app/${path}${portfolioId ? `?portfolio=${portfolioId}` : ''}`}
                onClick={() => setCommand(false)}
              >
                <Icon size={17} />
                {label}
                <Command size={13} />
              </Link>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  primary,
  positive,
}: {
  label: string;
  value: string;
  detail?: string;
  primary?: boolean;
  positive?: boolean;
}) {
  return (
    <div className={`metric ${primary ? 'primary-metric' : ''}`}>
      <span className="metric-label">{label}</span>
      <strong className={positive === true ? 'positive' : positive === false ? 'negative' : ''}>
        {value}
      </strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
function Holdings({ data, onTrade }: { data: Data; onTrade: (symbol: string) => void }) {
  return data.positions.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Quantity</th>
            <th>Market value</th>
            <th>Unrealized P&L</th>
          </tr>
        </thead>
        <tbody>
          {data.positions.map((h) => (
            <tr key={h.id}>
              <td>
                <button className="instrument" onClick={() => onTrade(h.symbol)}>
                  <span className="ticker-avatar">{h.symbol.slice(0, 2)}</span>
                  <span>
                    <strong>{h.symbol}</strong>
                    <small>{h.name}</small>
                  </span>
                </button>
              </td>
              <td>
                {Number(h.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                <small className="cell-sub">Avg {cash(h.averageCost)}</small>
              </td>
              <td>
                {cash(h.value)}
                <small className="cell-sub">Close {h.priceAsOf || 'Unavailable'}</small>
              </td>
              <td className={Number(h.unrealizedPnl) >= 0 ? 'positive' : 'negative'}>
                {cash(h.unrealizedPnl)}
                <small className="cell-sub">
                  {h.stale ? 'Stale observation' : `${h.weight?.toFixed(1) || '—'}% of equity`}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="Capital waiting for a thesis"
      text="Your virtual cash is ready. Place a paper order to add your first position."
    />
  );
}
