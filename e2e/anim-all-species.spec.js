import { test, expect } from '@playwright/test';

test('sample all species animation frequencies', { timeout: 600_000 }, async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  // Wait for dolphins to spawn (T+100s) and have time to move around
  console.log('Waiting for dolphins to spawn (T+100s) and reproduce...');
  await page.waitForFunction(
    () => {
      const d = window.__debug;
      let dolphins = 0;
      for (const c of d.dolphinPool.pool) {
        if (c.active && !c.dead) dolphins++;
      }
      return dolphins >= 1;
    },
    { timeout: 500_000, polling: 2000 }
  );

  console.log('Multiple dolphins active! Sampling...\n');

  // Sample all species over 5 seconds
  console.log('--- Sampling all species over 5 seconds (every 1s) ---');
  for (let t = 0; t < 5; t++) {
    await page.waitForTimeout(1000);
    const snapshot = await page.evaluate(() => {
      const d = window.__debug;
      const out = [];
      const pools = [
        { pool: d.fishPool, type: 'fish' },
        { pool: d.dolphinPool, type: 'dolphin' },
        { pool: d.manateePool, type: 'manatee' },
      ];
      for (const { pool, type } of pools) {
        let sampled = 0;
        for (const c of pool.pool) {
          if (!c.active || c.dead || c.animControllers.length === 0) continue;
          if (sampled >= 2) break; // 2 per species
          sampled++;
          const bones = c.animControllers.map(a => ({
            bone: a.target.name || '(mesh)',
            freq: a.frequency.toFixed(4),
            amp: a.amplitude.toFixed(4),
            movingFreq: a.movingFrequency.toFixed(4),
            chainDepth: a.chainDepth.toFixed(2),
          }));
          out.push({
            type,
            speed: c.body.velocity.length().toFixed(2),
            intensity: c.animControllers[0].intensity.toFixed(3),
            turnRate: c.turnRate?.toFixed(3) || '0',
            bankAngle: c.bankAngle?.toFixed(3) || '0',
            enginesOn: c.enginesOn,
            bones,
          });
        }
      }
      return out;
    });

    console.log(`\n  T+${t + 1}s:`);
    for (const s of snapshot) {
      console.log(`    [${s.type}] spd=${s.speed} int=${s.intensity} turn=${s.turnRate} bank=${s.bankAngle} eng=${s.enginesOn}`);
      for (const b of s.bones) {
        console.log(`      ${b.bone}: freq=${b.freq} movFreq=${b.movingFreq} amp=${b.amp} depth=${b.chainDepth}`);
      }
    }
  }

  // Check frequency cap violations across all creatures
  const violations = await page.evaluate(() => {
    const d = window.__debug;
    const issues = [];
    for (const pool of [d.fishPool, d.dolphinPool, d.manateePool]) {
      for (const c of pool.pool) {
        if (!c.active || c.dead) continue;
        for (const a of c.animControllers) {
          if (a.movingFrequency > 0.81) {
            issues.push(`${c.type}/${a.target.name}: movingFreq=${a.movingFrequency.toFixed(4)} exceeds 0.8 cap`);
          }
          if (a.frequency > 0.85) {
            issues.push(`${c.type}/${a.target.name}: currentFreq=${a.frequency.toFixed(4)} exceeds cap`);
          }
        }
      }
    }
    return issues;
  });

  // Population summary
  const pop = await page.evaluate(() => {
    const d = window.__debug;
    const count = (pool) => {
      let n = 0;
      for (const c of pool.pool) if (c.active && !c.dead) n++;
      return n;
    };
    return {
      fish: count(d.fishPool),
      dolphin: count(d.dolphinPool),
      manatee: count(d.manateePool),
      stageTimer: d.stageTimer?.toFixed(1),
    };
  });
  console.log(`\nPopulation: Fish=${pop.fish} Dolphin=${pop.dolphin} Manatee=${pop.manatee} (T=${pop.stageTimer}s)`);

  if (violations.length > 0) {
    console.log('\n⚠ FREQUENCY CAP VIOLATIONS:');
    for (const v of violations) console.log(`  ${v}`);
  } else {
    console.log('✓ All frequencies within caps');
  }

  // Screenshots
  await page.keyboard.press('Tab');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'e2e/anim-all-species.png', fullPage: true });

  expect(errors, 'No uncaught exceptions').toHaveLength(0);
  expect(violations, 'No frequency cap violations').toHaveLength(0);
  expect(pop.dolphin, 'At least 1 dolphin sampled').toBeGreaterThanOrEqual(1);
});
