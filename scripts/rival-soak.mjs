import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.ATELIER_QA_URL || 'http://127.0.0.1:4173/';
const OUT = 'rival-artifacts/rival-soak.json';
const browser = await chromium.launch({
  headless:true,
  ...(process.env.ATELIER_QA_BROWSER === 'chrome' ? { channel:'chrome' } : {}),
});

try {
  const page = await browser.newPage({ viewport:{ width:1280, height:720 }, deviceScaleFactor:1 });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err?.stack || err)));
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => !!window.__atelierRivalLab, null, { timeout:5000 });

  const report = await page.evaluate(() => window.__atelierRivalLab.runSuite([11,29,47,83]));
  if (pageErrors.length) throw new Error('browser errors: ' + pageErrors.join(' | '));

  await mkdir('rival-artifacts', { recursive:true });
  await writeFile(OUT, JSON.stringify(report, null, 2) + '\n');

  const deadlocked = report.matches.filter(m => m.deadlocked);
  if (deadlocked.length) {
    throw new Error('deadlocked rival matches: ' +
      deadlocked.map(m => `${m.matchup.join(' vs ')} seed ${m.seed} max-dead ${m.maxDeadPuckSeconds}s`).join('; '));
  }
  const timedOut = report.matches.filter(m => m.timedOut || m.winner < 0 || Math.max(...m.score) < 5);
  if (timedOut.length) {
    throw new Error('rival matches exceeded 240 simulated seconds: ' +
      timedOut.map(m => `${m.matchup.join(' vs ')} seed ${m.seed} score ${m.score.join('-')} duration ${m.duration}`).join('; '));
  }

  const totalGoals = report.matches.reduce((n,m) => n + m.score[0] + m.score[1], 0);
  const ownGoals = report.matches.reduce((n,m) => n + m.sides[0].ownGoals + m.sides[1].ownGoals, 0);
  const ownGoalRate = ownGoals / Math.max(1, totalGoals);
  if (ownGoalRate > 0.18)
    throw new Error(`AI own-goal rate too high: ${(ownGoalRate * 100).toFixed(1)}%`);

  for (const match of report.matches) {
    for (const side of match.sides) {
      if (side.strikes < 1)
        throw new Error(`${side.name} produced zero strikes in ${match.matchup.join(' vs ')} seed ${match.seed}`);
    }
  }

  const r = report.self.Rookie;
  const p = report.self['Club Pro'];
  const c = report.self.Champion;
  if (!(r.bankRate < p.bankRate && p.bankRate < c.bankRate))
    throw new Error(`bank personality collapsed: rookie=${r.bankRate}, pro=${p.bankRate}, champion=${c.bankRate}`);
  if (!(r.keeperReadRate < p.keeperReadRate && p.keeperReadRate < c.keeperReadRate))
    throw new Error(`keeper-read personality collapsed: rookie=${r.keeperReadRate}, pro=${p.keeperReadRate}, champion=${c.keeperReadRate}`);
  if (!(c.rebounds > r.rebounds))
    throw new Error(`pressure personality collapsed: champion rebounds=${c.rebounds}, rookie=${r.rebounds}`);

  console.log('Rival soak passed');
  console.log(JSON.stringify({
    matches: report.matches.length,
    ownGoalRate:+ownGoalRate.toFixed(3),
    self:report.self,
  }, null, 2));
} finally {
  await browser.close();
}
