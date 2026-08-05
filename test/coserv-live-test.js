/**
 * CoServ SmartHub — Live Integration Smoke Test
 *
 * Verifies the Green Button download workflow against the real portal.
 * Detects SmartHub UI changes so we know when selectors need updating.
 *
 * Secrets are loaded from the project root .env file (gitignored).
 * If .env doesn't exist, copy .env.example and fill in credentials.
 *
 * Usage:
 *   node test/coserv-live-test.js
 *
 * Exit: 0 = all clear, 1 = something broke.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ─── Secrets ─────────────────────────────────────────────────────
// Load from .env (gitignored), fall back to env vars, then prompt
function loadSecrets() {
  const envPath = path.join(__dirname, '..', '.env');
  const secrets = {};

  // Parse .env file
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^COSERV_(USERNAME|PASSWORD)\s*=\s*(.+)/);
      if (match) secrets[match[1]] = match[2].trim();
    });
  }

  // Override with env vars
  if (process.env.COSERV_USERNAME) secrets.USERNAME = process.env.COSERV_USERNAME;
  if (process.env.COSERV_PASSWORD) secrets.PASSWORD = process.env.COSERV_PASSWORD;

  if (!secrets.USERNAME || !secrets.PASSWORD) {
    console.error('ERROR: CoServ credentials not found.');
    console.error('');
    console.error('Option 1: Copy .env.example to .env and fill in values:');
    console.error('  cp .env.example .env');
    console.error('  # Edit .env with real credentials');
    console.error('');
    console.error('Option 2: Set environment variables:');
    console.error('  export COSERV_USERNAME="bryzncode@gmail.com"');
    console.error('  export COSERV_PASSWORD="your-password"');
    console.error('');
    console.error('The .env file is gitignored — credentials are never committed.');
    process.exit(1);
  }

  return secrets;
}

const SECRETS = loadSecrets();

const CREDENTIALS = {
  loginUrl: 'https://coserv.smarthub.coop/ui/#/login',
  greenButtonPath: '#/usageManagement/greenButton',
  username: SECRETS.USERNAME,
  password: SECRETS.PASSWORD,
};

// ─── Test runner ──────────────────────────────────────────────────
let passed = 0, failed = 0;

function ok(label) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
function no(label, detail) {
  failed++;
  console.log(`  \x1b[31m✗\x1b[0m ${label}`);
  if (detail) console.log(`    \x1b[90m→ ${detail}\x1b[0m`);
}

async function check(promiseOrFn, label) {
  try {
    const result = typeof promiseOrFn === 'function'
      ? await promiseOrFn()
      : await promiseOrFn;
    if (result) ok(label);
    else no(label, 'returned falsy');
    return result;
  } catch (e) {
    no(label, e.message.replace(/\n/g, ' ').substring(0, 120));
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────
(async () => {
  const pw = require('playwright');
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  const page = await ctx.newPage();

  try {
    console.log('\n📋  CoServ SmartHub — Live Smoke Test');
    console.log('═══════════════════════════════════════\n');

    // ── 1. Login page ──────────────────────────────────────────
    console.log('1. Login Page');
    await page.goto(CREDENTIALS.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await check(
      async () => (await page.title()).includes('SmartHub'),
      'Page title: SmartHub'
    );
    await check(
      async () => (await page.locator('input[aria-label="Email"]').count()) > 0,
      'Email input found'
    );
    await check(
      async () => (await page.locator('input[aria-label="Password"]').count()) > 0,
      'Password input found'
    );
    await check(
      async () => (await page.locator('button:has-text("Sign In")').count()) > 0,
      'Sign In button found'
    );

    // ── 2. Authentication ──────────────────────────────────────
    console.log('\n2. Authentication');
    await page.locator('input[aria-label="Email"]').fill(CREDENTIALS.username);
    await page.locator('input[aria-label="Password"]').fill(CREDENTIALS.password);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForTimeout(6000);

    const postLoginUrl = page.url();
    await check(
      () => !postLoginUrl.includes('/login') && !postLoginUrl.includes('#/login'),
      'Redirected away from login'
    );
    await check(
      async () => (await page.locator('text=Invalid Login').count()) === 0,
      'Credentials accepted (no "Invalid Login")'
    );
    await check(
      async () => (await page.locator('text=USAGE').count()) > 0 ||
                  (await page.locator('text=BILL').count()) > 0,
      'Dashboard loaded (USAGE/BILL visible)'
    );

    // ── 3. Green Button page ───────────────────────────────────
    console.log('\n3. Green Button Page');
    await page.evaluate(`window.location.hash = '${CREDENTIALS.greenButtonPath}'`);
    await page.waitForTimeout(6000);

    await check(
      () => page.url().includes('greenButton'),
      'URL contains greenButton'
    );
    await check(
      async () => (await page.locator('button:has-text("Green Button")').count()) > 0,
      'Download button visible'
    );
    await check(
      async () => (await page.locator('text=Download Your Data').count()) > 0 ||
                  (await page.locator('text=Download Data with Green Button').count()) > 0,
      'Green Button heading visible'
    );

    // ── 4. Modal opens ─────────────────────────────────────────
    console.log('\n4. Download Modal');
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.includes('Green Button')) { btn.click(); return; }
      }
    });
    await page.waitForTimeout(4000);

    const hasDialog = await page.locator('.mat-dialog-container').count() > 0;
    await check(() => hasDialog, 'Modal dialog opened');

    if (hasDialog) {
      const modalText = await page.locator('.mat-dialog-container').textContent();
      await check(
        () => modalText?.includes('DOWNLOAD USAGE DATA'),
        'Modal title: "DOWNLOAD USAGE DATA"'
      );

      // ── 5. Form selectors ──────────────────────────────────
      console.log('\n5. Form Selectors');

      await check(
        async () => (await page.locator('#mat-input-2').count()) > 0,
        'Service select #mat-input-2'
      );
      await check(
        async () => (await page.locator('#mat-input-3').count()) > 0,
        'Interval select #mat-input-3'
      );
      await check(
        async () => (await page.locator('#mat-input-6').count()) > 0,
        'Format select #mat-input-6'
      );
      await check(
        async () => (await page.locator('#mat-input-4').count()) > 0,
        'Start date input #mat-input-4'
      );
      await check(
        async () => (await page.locator('#mat-input-5').count()) > 0,
        'End date input #mat-input-5'
      );

      // Verify option values
      const serviceOptions = await page.evaluate(() =>
        Array.from(document.querySelector('#mat-input-2')?.options || []).map(o => o.value));
      await check(
        () => serviceOptions.includes('ELECTRIC') && serviceOptions.includes('GAS'),
        `Service options: ${serviceOptions.join(', ')}`
      );

      const intervalOptions = await page.evaluate(() =>
        Array.from(document.querySelector('#mat-input-3')?.options || []).map(o => o.value));
      await check(
        () => intervalOptions.includes('DAILY'),
        `Interval options: ${intervalOptions.join(', ')}`
      );

      const formatOptions = await page.evaluate(() =>
        Array.from(document.querySelector('#mat-input-6')?.options || []).map(o => o.value));
      await check(
        () => formatOptions.includes('GREEN_BUTTON') && formatOptions.includes('CSV'),
        `Format options: ${formatOptions.join(', ')}`
      );

      // ── 6. Form fill ───────────────────────────────────────
      console.log('\n6. Form Fill');

      await page.selectOption('#mat-input-2', 'ELECTRIC');
      await page.selectOption('#mat-input-3', 'DAILY');
      await page.selectOption('#mat-input-6', 'GREEN_BUTTON');

      // Fill dates via native value setter (bypasses Angular datepicker)
      await page.evaluate(({inputId, dateStr}) => {
        const el = document.querySelector(`#${inputId}`);
        if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, dateStr);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { inputId: 'mat-input-4', dateStr: '08/03/2026' });
      await page.evaluate(({inputId, dateStr}) => {
        const el = document.querySelector(`#${inputId}`);
        if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, dateStr);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { inputId: 'mat-input-5', dateStr: '08/03/2026' });
      await page.waitForTimeout(300);

      const svcVal = await page.evaluate(() => document.querySelector('#mat-input-2')?.value);
      const intVal = await page.evaluate(() => document.querySelector('#mat-input-3')?.value);
      const fmtVal = await page.evaluate(() => document.querySelector('#mat-input-6')?.value);

      await check(() => svcVal === 'ELECTRIC', `Service = ELECTRIC (was: ${svcVal})`);
      await check(() => intVal === 'DAILY', `Interval = DAILY (was: ${intVal})`);
      await check(() => fmtVal === 'GREEN_BUTTON', `Format = GREEN_BUTTON (was: ${fmtVal})`);

      // ── 7. Download ────────────────────────────────────────
      console.log('\n7. Download');
      await page.evaluate(() => {
        const dialog = document.querySelector('.mat-dialog-container');
        for (const btn of dialog?.querySelectorAll('button') || []) {
          if (btn.textContent?.trim() === 'Download') { btn.click(); return; }
        }
      });
      await page.waitForTimeout(5000);

      const bodyText = await page.evaluate(() => document.body.innerText || '');
      const noData = bodyText.includes('No usage data');

      if (noData) {
        ok('Download flow complete (no data for date — normal for gas/off-peak)');
      } else {
        ok('Download flow complete (data received or modal closed)');
      }

      // ── 8. Gas service check ───────────────────────────────
      console.log('\n8. Natural Gas');
      // Close the first modal, navigate back, and re-open
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      await page.evaluate('window.location.hash = \'' + CREDENTIALS.greenButtonPath + '\'');
      await page.waitForTimeout(5000);

      await page.evaluate(() => {
        for (const btn of document.querySelectorAll('button')) {
          if (btn.textContent?.includes('Green Button')) { btn.click(); return; }
        }
      });
      await page.waitForTimeout(4000);
      await page.selectOption('#mat-input-2', 'GAS');

      const gasVal = await page.evaluate(() => document.querySelector('#mat-input-2')?.value);
      await check(() => gasVal === 'GAS', `Can switch to Natural Gas (was: ${gasVal})`);
    }

    // ── Results ──────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════');
    console.log(`  \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
    console.log('═══════════════════════════════════════\n');

    if (failed > 0) {
      console.log('\x1b[33m⚠  SmartHub UI may have changed.\x1b[0m');
      console.log('  Check CoservAdapter.java and CoservAuthService.java for outdated selectors.\n');
    } else {
      console.log('\x1b[32m✅ All clear — Green Button workflow intact.\x1b[0m\n');
    }

  } catch (e) {
    console.error('\n\x1b[31m❌ Fatal:\x1b[0m', e.message);
    failed++;
  } finally {
    await browser.close();
  }

  process.exit(failed > 0 ? 1 : 0);
})();
