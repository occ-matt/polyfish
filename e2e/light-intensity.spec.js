import { test, expect } from '@playwright/test';

test('compare ambient light at 1.0 vs 1.5 intensity', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  await page.waitForFunction(
    () => window.__debug?.scene != null,
    { timeout: 15_000 }
  );

  await page.waitForFunction(
    () => window.__debug?.stageTimer > 12,
    { timeout: 120_000, polling: 1000 }
  );

  // Screenshot at current ambient (1.5)
  const intensities = await page.evaluate(() => {
    const scene = window.__debug.scene;
    const result = {};
    for (const child of scene.children) {
      if (child.isAmbientLight) result.ambient = child.intensity;
      if (child.isDirectionalLight) result.directional = child.intensity;
    }
    return result;
  });
  console.log(`Current intensities: ambient=${intensities.ambient}, directional=${intensities.directional}`);
  await page.screenshot({ path: 'e2e/light-ambient-1.5.png', fullPage: true });

  // Set ambient to old value (1.0) and screenshot
  await page.evaluate(() => {
    const scene = window.__debug.scene;
    for (const child of scene.children) {
      if (child.isAmbientLight) child.intensity = 1.0;
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/light-ambient-1.0.png', fullPage: true });

  console.log('Screenshots saved: e2e/light-ambient-1.5.png and e2e/light-ambient-1.0.png');
  expect(intensities.ambient).toBe(1.5);
});
