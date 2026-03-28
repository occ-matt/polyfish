import { test, expect } from '@playwright/test';

test('Verify swimming animation in narrative mode', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  // Wait for fish to spawn (T+7s game time)
  await page.waitForFunction(
    () => window.__debug?.stageTimer > 10,
    { timeout: 120_000, polling: 1000 }
  );

  // Sample bone rotations over time
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const sample = await page.evaluate(() => {
      const d = window.__debug;
      for (const c of d.fishPool.pool) {
        if (!c.active || c.dead) continue;
        const bones = {};
        c.mesh.traverse((child) => {
          if (child.isBone) {
            bones[child.name] = {
              qx: child.quaternion.x.toFixed(6),
              qy: child.quaternion.y.toFixed(6),
              qz: child.quaternion.z.toFixed(6),
              qw: child.quaternion.w.toFixed(6),
            };
          }
        });
        return {
          animControllers: c.animControllers.length,
          animEnabled: c.animControllers.map(a => a.enabled),
          bones,
        };
      }
      return null;
    });
    samples.push(sample);
    await page.waitForTimeout(200);
  }

  console.log('\n========== NARRATIVE ANIM CHECK ==========');
  if (!samples[0]) {
    console.log('No active fish found!');
  } else {
    console.log(`animControllers: ${samples[0].animControllers}`);
    console.log(`enabled: ${JSON.stringify(samples[0].animEnabled)}`);

    for (const boneName of Object.keys(samples[0].bones)) {
      const values = samples.filter(s => s).map(s => s.bones[boneName]);
      const qxVals = values.map(v => parseFloat(v.qx));
      const qyVals = values.map(v => parseFloat(v.qy));
      const qzVals = values.map(v => parseFloat(v.qz));
      const rangeX = Math.max(...qxVals) - Math.min(...qxVals);
      const rangeY = Math.max(...qyVals) - Math.min(...qyVals);
      const rangeZ = Math.max(...qzVals) - Math.min(...qzVals);
      const maxRange = Math.max(rangeX, rangeY, rangeZ);
      const animating = maxRange > 0.001;
      console.log(`  ${boneName}: rangeX=${rangeX.toFixed(5)} rangeY=${rangeY.toFixed(5)} rangeZ=${rangeZ.toFixed(5)} ${animating ? '✓ ANIMATING' : '✗ STATIC'}`);
    }
  }
  console.log('==========================================\n');

  expect(pageErrors).toHaveLength(0);
});
