import { test, expect } from '@playwright/test';

test('headed diagnostic — watch for errors', async ({ page }) => {
  const logs = [];
  const errors = [];
  const warnings = [];

  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') errors.push(text);
    else if (type === 'warning') warnings.push(text);
    logs.push(`[${type}] ${text}`);
  });

  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await page.goto('/');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  await page.waitForFunction(
    () => window.__debug?.scene != null,
    { timeout: 15_000 }
  );

  // Let the game run — poll timer to see how fast it advances
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(3000);
    const t = await page.evaluate(() => window.__debug?.stageTimer?.toFixed(2));
    const errs = await page.evaluate(() => {
      // Check for any errors thrown in the game loop
      return window.__polyfish_errors || [];
    });
    console.log(`[poll ${i}] stageTimer=${t} errors=${errs.length}`);
    if (parseFloat(t) > 12) break; // enough to see fish + plants
  }

  const state = await page.evaluate(() => {
    const d = window.__debug;
    const countActive = (pool) => {
      let alive = 0, dead = 0;
      for (const c of pool.pool) {
        if (c.active && !c.dead) alive++;
        else if (c.active && c.dead) dead++;
      }
      return { alive, dead };
    };
    return {
      stageTimer: d.stageTimer?.toFixed(2),
      fish: countActive(d.fishPool),
      dolphin: countActive(d.dolphinPool),
      manatee: countActive(d.manateePool),
      plant: countActive(d.plantPool),
      food: countActive(d.foodPool),
      seed: countActive(d.seedPool),
    };
  });

  console.log('\n========== GAME STATE ==========');
  console.log(JSON.stringify(state, null, 2));

  console.log('\n========== CONSOLE ERRORS ==========');
  for (const e of errors) console.log(`  ERROR: ${e}`);
  if (errors.length === 0) console.log('  (none)');

  console.log('\n========== UNCAUGHT EXCEPTIONS ==========');
  for (const e of pageErrors) console.log(`  UNCAUGHT: ${e}`);
  if (pageErrors.length === 0) console.log('  (none)');

  console.log('\n========== WARNINGS (Jolt/physics related) ==========');
  for (const w of warnings) {
    if (w.includes('Jolt') || w.includes('physics') || w.includes('HeightField') || w.includes('ragdoll')) {
      console.log(`  WARN: ${w}`);
    }
  }

  console.log('\n========== ALL LOGS ==========');
  for (const log of logs) console.log(log);

  await page.screenshot({ path: 'e2e/headed-diagnostic.png', fullPage: true });

  expect(pageErrors, 'No uncaught exceptions').toHaveLength(0);
});
