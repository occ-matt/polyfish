import { test, expect } from '@playwright/test';

test('PolyFish loads and runs — capture logs', async ({ page }) => {
  const logs = [];
  const errors = [];
  const warnings = [];

  // Capture all console output
  page.on('console', (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') {
      errors.push(text);
    } else if (type === 'warning') {
      warnings.push(text);
    }
    logs.push(`[${type}] ${text}`);
  });

  // Capture uncaught exceptions
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  // Track ALL responses to find 404s
  const badResponses = [];
  page.on('response', (res) => {
    if (res.status() >= 400) {
      badResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  // Also track failed requests
  const failedRequests = [];
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`);
  });

  // Navigate to the app
  await page.goto('/');

  // Wait for canvas
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Wait for initialization
  await page.waitForFunction(
    () => window.__debug?.scene != null,
    { timeout: 15_000 }
  );

  // Wait until stageTimer reaches past 10s (fish spawn at T+7s)
  // Use polling since the game clock runs slower than wall time
  await page.waitForFunction(
    () => window.__debug?.stageTimer > 10,
    { timeout: 120_000, polling: 1000 }
  );

  // Give creatures a few more seconds of game time to do things
  await page.waitForFunction(
    () => window.__debug?.stageTimer > 15,
    { timeout: 120_000, polling: 1000 }
  );

  // Gather diagnostic state
  const state = await page.evaluate(() => {
    const d = window.__debug;
    if (!d) return { error: 'no __debug' };

    const countActive = (pool) => {
      let alive = 0, dead = 0;
      for (const c of pool.pool) {
        if (c.active && !c.dead) alive++;
        else if (c.active && c.dead) dead++;
      }
      return { alive, dead, total: pool.pool.length };
    };

    return {
      fish: countActive(d.fishPool),
      dolphin: countActive(d.dolphinPool),
      manatee: countActive(d.manateePool),
      food: countActive(d.foodPool),
      seed: countActive(d.seedPool),
      plant: countActive(d.plantPool),
      currentMode: d.modeManager?.currentMode?.name ?? 'none',
      sceneChildren: d.scene?.children?.length ?? 0,
      stageTimer: d.stageTimer?.toFixed(2),
      stageRunning: d.stageRunning,
      stageEvents: d.stageEvents?.map(e => ({ time: e.time, type: e.type, fired: e.fired })),
    };
  });

  // Take screenshot
  await page.screenshot({ path: 'e2e/screenshot.png', fullPage: true });

  // Print results
  console.log('\n========== BROWSER CONSOLE LOGS ==========');
  for (const log of logs) {
    console.log(log);
  }
  console.log('==========================================\n');

  if (badResponses.length > 0) {
    console.log('--- HTTP 4xx/5xx ---');
    for (const r of badResponses) console.log(`  ${r}`);
  }

  if (failedRequests.length > 0) {
    console.log('--- Failed requests ---');
    for (const r of failedRequests) console.log(`  ${r}`);
  }

  console.log('\n--- App State ---');
  console.log(JSON.stringify(state, null, 2));

  console.log(`\nWarnings: ${warnings.length}`);
  console.log(`Console errors: ${errors.length}`);
  console.log(`Page errors (uncaught): ${pageErrors.length}`);
  for (const e of pageErrors) console.log(`  UNCAUGHT: ${e}`);

  console.log('\nScreenshot saved to e2e/screenshot.png');

  // Assertions
  expect(pageErrors, 'No uncaught exceptions').toHaveLength(0);
  expect(state.fish.alive, 'Fish should have spawned').toBeGreaterThan(0);
  expect(state.stageEvents[0].fired, 'Fish stage event should have fired').toBe(true);
});
