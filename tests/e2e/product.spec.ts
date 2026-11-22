import { test, expect, type Page } from '@playwright/test';
import type { Data } from '../../src/lib/service';
const password = 'Synthetic research password 123';
async function ready(page: Page) {
  await expect(page.getByRole('combobox', { name: 'Selected portfolio' })).toBeVisible();
}
async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore the live demo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Portfolio overview', exact: true }),
  ).toBeVisible();
  await ready(page);
}
async function go(page: Page, view: string) {
  await page.goto('/app/' + view);
  await ready(page);
}
async function data(page: Page): Promise<Data> {
  const r = await page.request.get('/api/data');
  expect(r.ok()).toBe(true);
  return r.json();
}
async function act(page: Page, body: Record<string, unknown>) {
  return page.request.post('/api/actions', { data: body });
}
async function order(page: Page, side = 'BUY', quantity = '1') {
  await page.getByRole('button', { name: 'Paper order', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Symbol', exact: true }).selectOption('AAPL');
  await d.getByRole('combobox', { name: 'Side', exact: true }).selectOption(side);
  await d.getByLabel('Quantity', { exact: true }).fill(quantity);
  await d.getByLabel('Fee (USD)', { exact: true }).fill('0.25');
  await d.getByRole('button', { name: 'Confirm paper order' }).click();
  return d;
}
test('all terminal views, actual candles, source labels, keyboard navigation, themes and responsive layout', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await demo(page);
  for (const view of ['markets', 'watchlists', 'risk', 'rebalance', 'activity', 'settings'])
    await go(page, view);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('dialog').getByRole('link', { name: 'Portfolio', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '90D', exact: true }).click();
  await expect(page.locator('.metric').filter({ hasText: 'PERIOD RETURN' })).toContainText(
    '90D window',
  );
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Markets', exact: true })
      .click();
  } else await go(page, 'markets');
  await expect(page.locator('.candle-chart canvas').first()).toBeVisible();
  await page.getByText('Accessible daily price table · latest 30 observations').click();
  await expect(page.getByRole('columnheader', { name: 'Volume', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search markets' }).fill('Apple');
  await expect(page.locator('.selected-row')).toContainText('AAPL');
  await page.getByRole('textbox', { name: 'Search markets' }).fill('uncovered');
  await expect(page.getByRole('heading', { name: 'No matching observations' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await go(page, 'portfolio');
  await page.screenshot({
    path: `public/screenshots/${info.project.name}-portfolio.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await go(page, 'markets');
  await expect(page.locator('.candle-chart canvas').first()).toBeVisible();
  await page.screenshot({
    path: `public/screenshots/${info.project.name}-markets.png`,
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
test('fractional paper buy and sale persist with fees, price provenance and immutable ledger', async ({
  page,
}) => {
  await demo(page);
  const before = await data(page);
  await expect(await order(page, 'BUY', '0.125')).toHaveCount(0);
  await expect(page.locator('.notice[role=status]')).toContainText('No real trade');
  await expect(await order(page, 'SELL', '0.05')).toHaveCount(0);
  await page.reload();
  await ready(page);
  const after = await data(page);
  expect(after.summary!.tradeCount).toBe(before.summary!.tradeCount + 2);
  expect(Number(after.positions.find((h) => h.symbol === 'AAPL')!.quantity)).toBeCloseTo(
    Number(before.positions.find((h) => h.symbol === 'AAPL')!.quantity) + 0.075,
    6,
  );
  expect(after.trades[0].side).toBe('SELL');
  expect(after.trades[0].fee).toBe('0.25000000');
  expect(after.source).toBe('SIMULATED');
  expect(after.trades[0].priceAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await go(page, 'activity');
  await expect(page.getByRole('table').first()).toContainText('0.050000');
});
test('oversells are rejected and retried requests cannot create duplicate fills', async ({
  page,
}) => {
  await demo(page);
  const before = await data(page);
  const dialog = await order(page, 'SELL', '999999');
  await expect(dialog.getByRole('alert')).toContainText('exceeds');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  const body = {
    action: 'trade.execute',
    portfolioId: before.portfolio!.id,
    symbol: 'AAPL',
    side: 'BUY',
    quantity: '0.01',
    fee: '0',
    idempotencyKey: crypto.randomUUID(),
  };
  expect((await act(page, body)).ok()).toBe(true);
  expect((await act(page, body)).ok()).toBe(true);
  expect((await data(page)).summary!.tradeCount).toBe(before.summary!.tradeCount + 1);
});
test('virtual cash flows change contributions and balance without creating investment profit', async ({
  page,
}) => {
  await demo(page);
  const before = await data(page);
  await page.getByRole('button', { name: 'Move cash', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Amount (USD)').fill('1234.56');
  await d.getByRole('button', { name: 'Record cash movement' }).click();
  await expect(d).toHaveCount(0);
  const after = await data(page);
  expect(Number(after.summary!.cash) - Number(before.summary!.cash)).toBeCloseTo(1234.56, 6);
  expect(after.summary!.netPnl).toBe(before.summary!.netPnl);
  expect(
    Number(after.summary!.netContributed) - Number(before.summary!.netContributed),
  ).toBeCloseTo(1234.56, 6);
});
test('watchlist create, add, remove and delete survive navigation', async ({ page }) => {
  await demo(page);
  await go(page, 'watchlists');
  await page.getByRole('button', { name: 'New watchlist', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Watchlist name').fill('E2E conviction');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create watchlist', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'E2E conviction', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Watchlist ticker' }).fill('MSFT');
  await page.getByRole('button', { name: 'Add symbol', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove MSFT' })).toBeVisible();
  await page.reload();
  await ready(page);
  const w = (await data(page)).watchlists.find((w) => w.name === 'E2E conviction')!;
  expect(w.symbols).toEqual(['MSFT']);
  await page
    .locator('.watchlist-picker')
    .getByRole('button', { name: /E2E conviction/ })
    .click();
  await page.getByRole('button', { name: 'Remove MSFT' }).click();
  await expect(page.getByRole('button', { name: 'Remove MSFT' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete watchlist' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await data(page)).watchlists.some((w) => w.name === 'E2E conviction')).toBe(false);
});
test('rebalancing estimates fees, saves target weights and never sends paper orders', async ({
  page,
}) => {
  await demo(page);
  const before = await data(page);
  await go(page, 'rebalance');
  for (const [s, w] of Object.entries({ AAPL: 0, MSFT: 0, NVDA: 0, SPY: 70, CASH: 30 }))
    await page.getByRole('spinbutton', { name: `${s} target weight`, exact: true }).fill(String(w));
  await page.getByRole('button', { name: 'Preview rebalance', exact: true }).click();
  await expect(
    page.getByText('Plan is funded after estimated fees.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Notional', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save target weights', exact: true }).click();
  await expect(page.locator('.notice[role=status]')).toContainText('No paper orders');
  const after = await data(page);
  expect(after.summary!.tradeCount).toBe(before.summary!.tradeCount);
  expect((after.portfolio!.targetWeights as Record<string, number>).SPY).toBe(70);
  await page.getByRole('spinbutton', { name: 'CASH target weight' }).fill('20');
  await page.getByRole('button', { name: 'Preview rebalance', exact: true }).click();
  await expect(page.locator('.notice[role=alert]')).toContainText('100%');
});
test('report export, portfolio settings and isolated demo reset preserve tenant boundaries', async ({
  page,
  browser,
}) => {
  await demo(page);
  const before = await data(page);
  await go(page, 'settings');
  await page
    .getByRole('textbox', { name: 'Portfolio name', exact: true })
    .fill('E2E research book');
  await page.getByRole('button', { name: 'Save portfolio settings' }).click();
  await expect(page.locator('.notice[role=status]')).toContainText('saved');
  await go(page, 'activity');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export report' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('quantdesk-paper-report.csv');
  const csv = await (
    await page.request.get('/api/report?portfolio=' + before.portfolio!.id)
  ).text();
  expect(csv).toContain('E2E research book');
  expect(csv).toContain('SIMULATED');
  expect(csv).toContain('Price as of');
  const isolated = await browser.newContext();
  try {
    const other = await isolated.newPage();
    await demo(other);
    expect((await other.request.get('/api/data?portfolio=' + before.portfolio!.id)).status()).toBe(
      404,
    );
    expect(
      (
        await other.request.get('/api/market?symbol=AAPL&portfolio=' + before.portfolio!.id)
      ).status(),
    ).toBe(404);
    expect(
      (await other.request.get('/api/report?portfolio=' + before.portfolio!.id)).status(),
    ).toBe(404);
    expect(
      (await act(other, { action: 'portfolio.delete', id: before.portfolio!.id })).status(),
    ).toBe(404);
  } finally {
    await isolated.close();
  }
  await page.getByRole('button', { name: 'Reset demo', exact: false }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore demo', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await data(page);
  expect(after.workspace.id).toBe(before.workspace.id);
  expect(after.portfolios).toHaveLength(2);
  expect(after.summary!.tradeCount).toBe(8);
  expect(after.portfolios[0].name).toBe('Core growth');
});
test('private registration, empty desk, portfolio CRUD, login and CSRF protection', async ({
  page,
}) => {
  const email = 'quant-' + crypto.randomUUID() + '@example.test';
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Synthetic researcher');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A fresh research desk' })).toBeVisible();
  await page.getByRole('button', { name: 'Create paper portfolio', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name', { exact: true }).fill('E2E private portfolio');
  await d.getByLabel('Starting virtual capital (USD)').fill('25000');
  await d.getByRole('button', { name: 'Create portfolio', exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Selected portfolio' })).toContainText(
    'E2E private portfolio',
  );
  expect((await data(page)).trades).toHaveLength(0);
  expect((await act(page, { action: 'demo.reset' })).status()).toBe(403);
  expect(
    (
      await page.request.post('/api/actions', {
        headers: { origin: 'https://untrusted.example' },
        data: { action: 'watchlist.create', name: 'Forbidden' },
      })
    ).status(),
  ).toBe(403);
  expect((await act(page, { action: 'market.refresh', symbol: 'SPY' })).status()).toBe(503);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3205/');
  expect((await page.request.get('/api/data')).status()).toBe(401);
  await page.goto('/app/portfolio');
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await ready(page);
  expect((await data(page)).portfolios[0].name).toBe('E2E private portfolio');
  await go(page, 'settings');
  await page.getByRole('button', { name: 'Delete paper portfolio' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await data(page)).portfolios).toHaveLength(0);
});

test('selecting another portfolio stays consistent across writes, navigation and reload', async ({
  page,
}, info) => {
  await demo(page);
  const d = await data(page);
  const second = d.portfolios[1];
  await page.getByRole('combobox', { name: 'Selected portfolio' }).selectOption(second.id);
  await expect(page.locator('.metric').first()).toContainText('$');
  await expect(page).toHaveURL(new RegExp(second.id));
  if (info.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link', { name: 'Trade ledger', exact: true })
    .click();
  await expect(page.getByRole('combobox', { name: 'Selected portfolio' })).toHaveValue(second.id);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Selected portfolio' })).toHaveValue(second.id);
  const r = await page.request.get('/api/data?portfolio=' + second.id);
  expect((await r.json()).trades).toHaveLength(2);
});
