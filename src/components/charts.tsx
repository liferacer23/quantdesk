'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { request } from './auth';
import type { Data } from '@/lib/service';
export function Performance({
  data,
  drawdown = false,
}: {
  data: Data['history'];
  drawdown?: boolean;
}) {
  return (
    <div
      className="chart"
      role="img"
      aria-label={
        drawdown
          ? 'Portfolio drawdown over selected range'
          : 'Time-weighted portfolio and benchmark performance, indexed to 100 at the start of the selected range'
      }
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 700, height: 265 }}
      >
        {drawdown ? (
          <AreaChart data={data}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" minTickGap={60} tickFormatter={(v) => String(v).slice(5)} />
            <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} width={48} />
            <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(2)}%`} />
            <Area
              dataKey="drawdown"
              name="Drawdown"
              stroke="#ef9578"
              fill="#ef957822"
              isAnimationActive={false}
            />
          </AreaChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" minTickGap={60} tickFormatter={(v) => String(v).slice(5)} />
            <YAxis
              domain={['auto', 'auto']}
              tickFormatter={(v) => Number(v).toFixed(0)}
              width={48}
            />
            <Tooltip formatter={(v) => Number(v).toFixed(2)} />
            <Legend />
            <Line
              dataKey="index"
              name="Portfolio · TWR"
              stroke="#59dbc5"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="benchmarkIndex"
              name="Benchmark · price only"
              stroke="#8a91a3"
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
interface Candle {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}
export function Candles({ symbol, portfolio }: { symbol: string; portfolio?: string }) {
  const ref = useRef<HTMLDivElement>(null),
    [rows, setRows] = useState<Candle[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    void request<{ candles: Candle[] }>(
      `/api/market?symbol=${encodeURIComponent(symbol)}${portfolio ? `&portfolio=${portfolio}` : ''}`,
    )
      .then((r) => {
        if (active) {
          setRows(r.candles);
          setError('');
          setBusy(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [symbol, portfolio]);
  useEffect(() => {
    if (!ref.current || !rows.length) return;
    let cleanup: undefined | (() => void),
      active = true;
    void import('lightweight-charts')
      .then(({ createChart, CandlestickSeries, ColorType }) => {
        if (!active || !ref.current) return;
        const chart = createChart(ref.current, {
          height: 330,
          layout: {
            background: { type: ColorType.Solid, color: '#10151e' },
            textColor: '#9ba6b8',
            attributionLogo: true,
          },
          grid: { vertLines: { color: '#1c2430' }, horzLines: { color: '#1c2430' } },
          timeScale: { timeVisible: false, borderColor: '#263040' },
          rightPriceScale: { borderColor: '#263040' },
        });
        const series = chart.addSeries(CandlestickSeries, {
          upColor: '#59dbc5',
          downColor: '#ef9578',
          borderVisible: false,
          wickUpColor: '#59dbc5',
          wickDownColor: '#ef9578',
        });
        series.setData(
          rows.map((r) => ({
            time: r.date,
            open: Number(r.open),
            high: Number(r.high),
            low: Number(r.low),
            close: Number(r.close),
          })),
        );
        chart.timeScale().fitContent();
        const observer = new ResizeObserver((entries) =>
          chart.applyOptions({ width: entries[0].contentRect.width }),
        );
        observer.observe(ref.current);
        cleanup = () => {
          observer.disconnect();
          chart.remove();
        };
      })
      .catch(() =>
        setError('The candlestick chart could not load. Daily prices remain available below.'),
      );
    return () => {
      active = false;
      cleanup?.();
    };
  }, [rows]);
  return (
    <>
      <div
        ref={ref}
        className="candle-chart"
        aria-label={`${symbol} daily candlestick chart. Scroll to zoom, drag to pan.`}
        role="img"
      />
      {busy && <p role="status">Loading daily observations…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !rows.length && !error && (
        <p className="notice">No observations available in this portfolio’s price source.</p>
      )}
      <div className="chart-credit">
        Lightweight Charts™ by{' '}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>{' '}
        · Daily OHLC · Scroll to zoom
      </div>
      <details>
        <summary>Accessible daily price table · latest 30 observations</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Close</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice(-30)
                .reverse()
                .map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{Number(r.open).toFixed(2)}</td>
                    <td>{Number(r.high).toFixed(2)}</td>
                    <td>{Number(r.low).toFixed(2)}</td>
                    <td>{Number(r.close).toFixed(2)}</td>
                    <td>{Number(r.volume).toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
