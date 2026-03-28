import { test, expect } from '@playwright/test';

test('Preview swimming animation', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  // Switch to editor mode (3) — static creatures, no AI, easy to observe
  await page.keyboard.press('3');
  await page.waitForTimeout(2000);

  // Take a series of screenshots over a few seconds to see animation
  const screenshots = [];
  for (let i = 0; i < 6; i++) {
    const path = `e2e/anim-frame-${i}.png`;
    await page.screenshot({ path, fullPage: true });
    screenshots.push(path);
    await page.waitForTimeout(500);
  }

  console.log('\nScreenshots saved:');
  for (const s of screenshots) console.log(`  ${s}`);

  // Also grab bone rotation data over time to verify animation is happening
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const sample = await page.evaluate(() => {
      const d = window.__debug;
      const result = {};
      for (const { pool, type } of d.allCreaturePools) {
        const creature = pool.pool[0];
        if (!creature?.mesh) continue;
        const bones = {};
        creature.mesh.traverse((child) => {
          if (child.isBone) {
            bones[child.name] = {
              qx: child.quaternion.x.toFixed(4),
              qy: child.quaternion.y.toFixed(4),
              qz: child.quaternion.z.toFixed(4),
              qw: child.quaternion.w.toFixed(4),
            };
          }
        });
        result[type] = bones;
      }
      return result;
    });
    samples.push(sample);
    await page.waitForTimeout(300);
  }

  // Check if quaternions are actually changing between samples
  console.log('\n========== ANIMATION VERIFICATION ==========');
  for (const type of ['fish', 'dolphin', 'manatee']) {
    if (!samples[0][type]) continue;
    console.log(`\n--- ${type.toUpperCase()} ---`);
    for (const boneName of Object.keys(samples[0][type])) {
      const values = samples.map(s => s[type][boneName]);
      const qyValues = values.map(v => parseFloat(v.qy));
      const range = Math.max(...qyValues) - Math.min(...qyValues);
      const changing = range > 0.001;
      console.log(`  ${boneName}: qy range=${range.toFixed(4)} ${changing ? '✓ ANIMATING' : '✗ STATIC'}`);
      // Print first and last sample
      console.log(`    t0: (${values[0].qx}, ${values[0].qy}, ${values[0].qz}, ${values[0].qw})`);
      console.log(`    t4: (${values[4].qx}, ${values[4].qy}, ${values[4].qz}, ${values[4].qw})`);
    }
  }
  console.log('\n=============================================\n');

  expect(pageErrors).toHaveLength(0);
});
