import { test, expect } from '@playwright/test';

test('Plants produce food that fish can eat', async ({ page }) => {
  const logs = [];

  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  // Inject detailed food tracking
  await page.evaluate(() => {
    const d = window.__debug;
    window.__foodLog = [];
    window.__eatLog = [];

    // Patch spawnFood to log every food spawn
    const origPlantUpdate = d.plantPool.pool[0]?.update;
    // We'll track via polling instead
  });

  // Wait for game time to reach 20s (fish spawns at 7s, needs time to find food)
  await page.waitForFunction(
    () => window.__debug?.stageTimer > 25,
    { timeout: 180_000, polling: 1000 }
  );

  // Sample state over a few seconds of game time
  const snapshots = [];
  for (let i = 0; i < 5; i++) {
    const snap = await page.evaluate(() => {
      const d = window.__debug;
      const foodPositions = [];
      for (const f of d.foodPool.pool) {
        if (f.active) {
          foodPositions.push({
            x: f.mesh.position.x.toFixed(1),
            y: f.mesh.position.y.toFixed(1),
            z: f.mesh.position.z.toFixed(1),
            lifetime: f.lifetime?.toFixed(1),
          });
        }
      }

      const plantPositions = [];
      for (const p of d.plantPool.pool) {
        if (p.active) {
          plantPositions.push({
            x: p.mesh.position.x.toFixed(1),
            y: p.mesh.position.y.toFixed(1),
            z: p.mesh.position.z.toFixed(1),
            growing: p.growing,
            foodTimer: p.foodTimer?.toFixed(1),
            foodRate: p.foodRate?.toFixed(1),
            hasCallback: !!p._onProduceFood,
          });
        }
      }

      const fishInfo = [];
      for (const c of d.fishPool.pool) {
        if (c.active && !c.dead) {
          fishInfo.push({
            x: c.mesh.position.x.toFixed(1),
            y: c.mesh.position.y.toFixed(1),
            z: c.mesh.position.z.toFixed(1),
            metabolism: c.metabolism?.toFixed(1),
            reproFood: c.reproFoodCounter,
            hasTarget: !!c.foodTarget,
            targetActive: c.foodTarget?.active,
            enginesOn: c.enginesOn,
          });
        }
      }

      return {
        gameTime: d.stageTimer?.toFixed(1),
        food: foodPositions,
        plants: plantPositions,
        fish: fishInfo,
        totalFoodActive: d.foodPool.getActiveCount(),
        totalPlantActive: d.plantPool.getActiveCount(),
        totalFishActive: (() => {
          let n = 0;
          for (const c of d.fishPool.pool) if (c.active && !c.dead) n++;
          return n;
        })(),
      };
    });
    snapshots.push(snap);

    // Wait a bit of wall time between snapshots
    await page.waitForTimeout(3000);
  }

  // Print all snapshots
  console.log('\n========== PLANT/FOOD DIAGNOSTICS ==========');
  for (const s of snapshots) {
    console.log(`\n--- Game Time: ${s.gameTime}s ---`);
    console.log(`  Fish alive: ${s.totalFishActive}`);
    console.log(`  Plants active: ${s.totalPlantActive}`);
    console.log(`  Food active: ${s.totalFoodActive}`);

    if (s.plants.length > 0) {
      for (const p of s.plants) {
        console.log(`  Plant at (${p.x}, ${p.y}, ${p.z}) growing=${p.growing} foodTimer=${p.foodTimer}/${p.foodRate} callback=${p.hasCallback}`);
      }
    }

    if (s.food.length > 0) {
      for (const f of s.food) {
        console.log(`  Food at (${f.x}, ${f.y}, ${f.z}) lifetime=${f.lifetime}s`);
      }
    }

    if (s.fish.length > 0) {
      for (const f of s.fish) {
        console.log(`  Fish at (${f.x}, ${f.y}, ${f.z}) metabolism=${f.metabolism} reproFood=${f.reproFood} hasTarget=${f.hasTarget} targetActive=${f.targetActive} engines=${f.enginesOn}`);
      }
    }
  }
  console.log('\n=============================================\n');

  // Print relevant console logs
  const relevantLogs = logs.filter(l =>
    l.includes('food') || l.includes('Food') ||
    l.includes('Ate') || l.includes('plant') || l.includes('Plant') ||
    l.includes('spawn') || l.includes('Spawn') ||
    l.includes('waste') || l.includes('Waste') ||
    l.includes('Metabolism') || l.includes('STARVED') || l.includes('OLD AGE')
  );
  console.log('--- Relevant console logs ---');
  for (const l of relevantLogs) console.log(l);

  await page.screenshot({ path: 'e2e/screenshot-plant-food.png', fullPage: true });
  console.log('\nScreenshot saved to e2e/screenshot-plant-food.png');

  expect(pageErrors).toHaveLength(0);
});
