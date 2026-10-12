import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createApp } from '../server.js';

// Use the locally installed package, or an explicitly supplied bundled module URL.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { server } = createApp({ persist: false });
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/server responded with a status of (401|400)/.test(m.text())) errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: /Sarah Lee/ }).click();
  await page.getByText('Dashboard connected', { exact: true }).waitFor();
  mkdirSync('tmp', { recursive: true });
  await page.screenshot({ path: 'tmp/dashboard-desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'desktop must not overflow');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'tmp/dashboard-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile must not overflow');
  await page.setViewportSize({ width: 1440, height: 1100 });

  await page.locator('#demo-panel summary').click();
  await page.getByRole('button', { name: 'Temperature excursion', exact: true }).click();
  await page.getByRole('button', { name: 'View alerts', exact: true }).click();
  await page.getByRole('heading', { name: /Temperature outside profile/ }).waitFor();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await page.getByText('Acknowledged by Sarah Lee', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'View delivery', exact: false }).first().click();
  await page.getByRole('button', { name: 'Normal readings', exact: true }).click();

  await page.getByRole('button', { name: 'Connection loss', exact: true }).click();
  await page.getByText('Connection lost', { exact: true }).waitFor({ timeout: 25000 });
  assert.equal(await page.locator('[data-select="RR-2048"] .delivery-right small').textContent(), 'ETA unavailable', 'delivery list must hide stale ETAs');
  await page.getByRole('button', { name: 'View alerts', exact: true }).click();
  await page.getByRole('heading', { name: /Telemetry connection lost/ }).waitFor();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Normal readings', exact: true }).click();

  await page.getByRole('button', { name: 'Report issue', exact: true }).click();
  await page.getByRole('textbox', { name: 'What happened?' }).fill('Corridor obstruction reported for review.');
  await page.getByRole('button', { name: 'Create incident', exact: true }).click();
  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve incident', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Arrive at ward', exact: true }).click();
  await page.getByRole('button', { name: 'Verify receipt', exact: true }).click();
  await page.getByRole('textbox', { name: 'Blood unit identifier' }).fill('WRONG');
  await page.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
  await page.getByText('Unit code does not match this delivery', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Blood unit identifier' }).fill('RBC-008421');
  await page.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
  await page.getByText('Delivery receipt verified and recorded.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Deliveries', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search deliveries' }).fill('2049');
  await page.waitForTimeout(2200);
  assert.equal(await page.getByRole('searchbox').inputValue(), '2049', 'search must survive live updates');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.locator('input[name="minC"]').first().isDisabled(), true, 'nurse cannot edit profiles');
  await page.getByRole('button', { name: /Switch demo workspace/ }).click();
  await page.getByRole('button', { name: /Jordan Chen/ }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[name="minC"]').first().fill('3');
  await page.getByRole('button', { name: 'Save example profile', exact: true }).first().click();
  await page.getByText('Example monitoring profile saved.', { exact: true }).waitFor();
  const profile = await page.evaluate(async () => (await (await fetch('/api/state')).json()).profiles.rbc);
  assert.equal(profile.minC, 3);
  assert.deepEqual(errors, [], 'no unexpected console errors or JavaScript exceptions');
  console.log('Browser verification passed: desktop/mobile layout, alerts, connection loss, incident resolution, receipt mismatch/correct code, search refresh and role/profile controls.');
  console.log('Screenshots: tmp/dashboard-desktop.png and tmp/dashboard-mobile.png');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
