import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.ATELIER_QA_URL || 'http://127.0.0.1:4173/';
const matrix = [
  {
    dir: 'compact',
    viewport: { width: 360, height: 640 },
    states: ['menu','rules','preferences','workshop-menu','workshop','goal','replay','pause','win','update'],
  },
  {
    dir: 'mobile',
    viewport: { width: 390, height: 844 },
    states: ['menu','rules','preferences','workshop-menu','workshop','workshop-free','progress','top','elevated','surface','goal','goal-rival','replay','pause','win','update'],
  },
  {
    dir: 'landscape',
    viewport: { width: 844, height: 390 },
    states: ['menu','workshop-menu','workshop','workshop-free','surface','goal','goal-rival','win'],
  },
  {
    dir: 'desktop',
    viewport: { width: 1440, height: 900 },
    states: ['menu','workshop-menu','progress','top','elevated','surface','win','update'],
  },
];

const browser = await chromium.launch({
  headless: true,
  ...(process.env.ATELIER_QA_BROWSER === 'chrome' ? { channel: 'chrome' } : {}),
});
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

      if (state === 'update') {
        const updateVisible = await page.evaluate(() => {
          const el = document.getElementById('updateReady');
          return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
        });
        if (!updateVisible) failures.push(`${group.dir}/update: update banner is not visible`);
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
    if (group.dir === 'mobile') {
      // Match Reel smoke test: queue three selected moments, advance them with
      // the same Skip/Next control a player sees, then land back on results.
      pageErrors = [];
      const reelUrl = new URL(BASE);
      reelUrl.searchParams.set('qa', 'win');
      await page.goto(reelUrl.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__atelierVisualQA?.freeze === true, null, { timeout:5000 });
      await page.evaluate(() => { window.__atelierVisualQA.freeze = false; });
      await page.click('#btnMatchReel');
      await page.waitForFunction(() =>
        document.body.classList.contains('replay-mode') &&
        (document.getElementById('replayContext')?.textContent || '').length > 0
      , null, { timeout:5000 });
      await page.screenshot({
        path: path.join(dir, 'match-reel.png'),
        fullPage:false,
        animations:'disabled',
      });
      for (let i = 0; i < 3; i++) await page.click('#replaySkip');
      await page.waitForFunction(() =>
        !document.getElementById('winov')?.classList.contains('hidden') &&
        !document.body.classList.contains('replay-mode')
      , null, { timeout:5000 });
      if (pageErrors.length) failures.push('mobile/match-reel: ' + pageErrors.join(' | '));

      // GIF export remains a separate single-moment path.
      pageErrors = [];
      const url = new URL(BASE);
      url.searchParams.set('qa', 'win');
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__atelierVisualQA?.freeze === true, null, { timeout:5000 });
      // Resume only the replay/export path. The fixture itself stays
      // deterministic until the user-equivalent GIF action begins.
      await page.evaluate(() => { window.__atelierVisualQA.freeze = false; });
      await page.click('[data-highlight-gif]');
      await page.waitForFunction(() => {
        const status = document.getElementById('gifStatus')?.textContent || '';
        const preview = document.getElementById('gifPreview');
        const save = document.getElementById('btnGifDownload');
        return status.startsWith('Ready') && preview?.naturalWidth > 0 && save?.disabled === false;
      }, null, { timeout:15000 });
      if (pageErrors.length) failures.push('mobile/gif-export: ' + pageErrors.join(' | '));
      await page.screenshot({
        path: path.join(dir, 'gif-export.png'),
        fullPage:false,
        animations:'disabled',
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
