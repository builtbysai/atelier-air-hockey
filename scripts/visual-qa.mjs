import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.ATELIER_QA_URL || 'http://127.0.0.1:4173/';
const matrix = [
  {
    dir: 'mobile',
    viewport: { width: 390, height: 844 },
    states: ['menu','rules','preferences','workshop-menu','workshop','progress','top','elevated','surface','goal','replay','pause','win','update'],
  },
  {
    dir: 'landscape',
    viewport: { width: 844, height: 390 },
    states: ['menu','workshop','surface','goal','win'],
  },
  {
    dir: 'desktop',
    viewport: { width: 1440, height: 900 },
    states: ['menu','workshop-menu','progress','top','elevated','surface','win','update'],
  },
];

const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  for (const group of matrix) {
    const dir = path.join('visual-artifacts', group.dir);
    await mkdir(dir, { recursive: true });
    const page = await browser.newPage({ viewport: group.viewport, deviceScaleFactor: 1 });
    let pageErrors = [];
    page.on('pageerror', err => pageErrors.push(String(err?.stack || err)));

    for (const state of group.states) {
      pageErrors = [];
      const url = new URL(BASE);
      url.searchParams.set('qa', state);
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(expected =>
        window.__atelierVisualQA?.freeze === true &&
        window.__atelierVisualQA?.state === expected,
        state,
        { timeout: 5000 }
      );
      await page.waitForTimeout(120);

      if (pageErrors.length) {
        failures.push(`${group.dir}/${state}: ${pageErrors.join(' | ')}`);
        continue;
      }

      const overflowingCards = await page.evaluate(() =>
        [...document.querySelectorAll('.overlay:not(.hidden) .card')]
          // Progress is intentionally a scrollable passport; gameplay/menu/result
          // surfaces should never require internal vertical scrolling.
          .filter(card => card.closest('.overlay')?.id !== 'progress')
          .filter(card => card.scrollHeight > card.clientHeight + 2)
          .map(card => ({
            id: card.closest('.overlay')?.id || 'unknown',
            scrollHeight: card.scrollHeight,
            clientHeight: card.clientHeight,
          }))
      );
      if (overflowingCards.length)
        failures.push(`${group.dir}/${state}: vertical card overflow ${JSON.stringify(overflowingCards)}`);

      await page.screenshot({
        path: path.join(dir, `${state}.png`),
        fullPage: false,
        animations: 'disabled',
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('Visual QA failures:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Visual QA screenshots captured successfully');
}
