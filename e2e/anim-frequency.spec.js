import { test, expect } from '@playwright/test';

test('sample creature animation frequencies', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  // Wait for creatures to spawn and start moving
  await page.waitForFunction(
    () => window.__debug?.stageTimer > 20,
    { timeout: 120_000, polling: 1000 }
  );

  // Sample animation controller state from random creatures
  const samples = await page.evaluate(() => {
    const d = window.__debug;
    const results = [];

    function samplePool(pool, type) {
      const creatures = [];
      for (const c of pool.pool) {
        if (c.active && !c.dead && c.animControllers.length > 0) {
          creatures.push(c);
        }
      }
      if (creatures.length === 0) return;

      // Pick up to 3 random creatures
      const count = Math.min(3, creatures.length);
      for (let i = 0; i < count; i++) {
        const c = creatures[Math.floor(Math.random() * creatures.length)];
        const boneData = c.animControllers.map(a => ({
          boneName: a.target.name || '(mesh)',
          baseFreq: a.baseFrequency,
          movingFreq: a.movingFrequency,
          currentFreq: a.frequency,
          currentAmplitude: a.amplitude,
          intensity: a.intensity,
          chainDepth: a.chainDepth,
          turnLag: a.turnLag,
        }));
        results.push({
          type,
          speed: c.body.velocity.length().toFixed(2),
          turnRate: c.turnRate?.toFixed(3) || '0',
          bankAngle: c.bankAngle?.toFixed(3) || '0',
          bones: boneData,
        });
      }
    }

    samplePool(d.fishPool, 'fish');
    samplePool(d.dolphinPool, 'dolphin');
    samplePool(d.manateePool, 'manatee');

    return results;
  });

  console.log('\n========== ANIMATION FREQUENCY SAMPLES ==========');
  for (const s of samples) {
    console.log(`\n[${s.type}] speed=${s.speed} turnRate=${s.turnRate} bankAngle=${s.bankAngle}`);
    for (const b of s.bones) {
      console.log(`  ${b.boneName}: baseFreq=${b.baseFreq} movingFreq=${b.movingFreq} ` +
        `currentFreq=${b.currentFreq.toFixed(3)} amp=${b.currentAmplitude.toFixed(3)} ` +
        `intensity=${b.intensity.toFixed(3)} chainDepth=${b.chainDepth.toFixed(2)} ` +
        `turnLag=${b.turnLag.toFixed(4)}`);
    }
  }
  console.log('\n==================================================');

  // Now sample over 3 seconds to watch frequency changes
  console.log('\n--- Sampling over 3 seconds (every 500ms) ---');
  for (let t = 0; t < 6; t++) {
    await page.waitForTimeout(500);
    const snapshot = await page.evaluate(() => {
      const d = window.__debug;
      const out = [];
      for (const pool of [d.fishPool, d.dolphinPool, d.manateePool]) {
        for (const c of pool.pool) {
          if (c.active && !c.dead && c.animControllers.length > 0) {
            const tail = c.animControllers[c.animControllers.length - 1];
            out.push({
              type: c.type,
              speed: c.body.velocity.length().toFixed(2),
              tailFreq: tail.frequency.toFixed(4),
              tailAmp: tail.amplitude.toFixed(4),
              intensity: tail.intensity.toFixed(3),
              enginesOn: c.enginesOn,
            });
            break; // one per type
          }
        }
      }
      return out;
    });
    const line = snapshot.map(s =>
      `${s.type}: freq=${s.tailFreq} amp=${s.tailAmp} int=${s.intensity} spd=${s.speed} eng=${s.enginesOn}`
    ).join(' | ');
    console.log(`  T+${((t + 1) * 0.5).toFixed(1)}s: ${line}`);
  }

  // Verify caps
  const violations = await page.evaluate(() => {
    const d = window.__debug;
    const issues = [];
    for (const pool of [d.fishPool, d.dolphinPool, d.manateePool]) {
      for (const c of pool.pool) {
        if (!c.active || c.dead) continue;
        for (const a of c.animControllers) {
          if (a.movingFrequency > 0.81) {
            issues.push(`${c.type}/${a.target.name}: movingFreq=${a.movingFrequency} exceeds 0.8 cap`);
          }
          if (a.frequency > 0.85) {
            issues.push(`${c.type}/${a.target.name}: currentFreq=${a.frequency} exceeds cap`);
          }
        }
      }
    }
    return issues;
  });

  if (violations.length > 0) {
    console.log('\n⚠ FREQUENCY CAP VIOLATIONS:');
    for (const v of violations) console.log(`  ${v}`);
  } else {
    console.log('\n✓ All frequencies within caps');
  }

  // Screenshot for visual reference
  await page.keyboard.press('Tab'); // screensaver for a good angle
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'e2e/anim-frequency.png', fullPage: true });

  expect(errors, 'No uncaught exceptions').toHaveLength(0);
  expect(violations, 'No frequency cap violations').toHaveLength(0);
});
