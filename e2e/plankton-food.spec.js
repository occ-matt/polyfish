import { test, expect } from '@playwright/test';

test('plankton food particles in scene', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  // Wait for ecosystem to develop — need food particles visible
  await page.waitForFunction(
    () => window.__debug?.stageTimer > 15,
    { timeout: 120_000, polling: 1000 }
  );

  // Switch to screensaver to get a good angle
  await page.keyboard.press('Tab');
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'e2e/plankton-food.png', fullPage: true });

  // Also get a close-up: switch back to FPS and look at the food
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  // Move camera close to where food spawns (near the plant)
  const foodPos = await page.evaluate(() => {
    const d = window.__debug;
    for (const f of d.foodPool.pool) {
      if (f.active) return { x: f.mesh.position.x, y: f.mesh.position.y, z: f.mesh.position.z };
    }
    return null;
  });

  if (foodPos) {
    await page.evaluate((pos) => {
      const cam = window.__debug.camera;
      cam.position.set(pos.x + 2, pos.y, pos.z + 2);
      cam.lookAt(pos.x, pos.y, pos.z);
    }, foodPos);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/plankton-closeup.png', fullPage: true });
  }

  const foodCount = await page.evaluate(() => window.__debug.foodPool.getActiveCount());
  console.log(`Active food particles: ${foodCount}`);

  expect(errors, 'No uncaught exceptions').toHaveLength(0);
});
