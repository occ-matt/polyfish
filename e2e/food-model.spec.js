import { test, expect } from '@playwright/test';

test('screenshot food models in viewer', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  // Switch to model viewer
  await page.keyboard.press('2');
  await page.waitForTimeout(1500);

  // Navigate to Food model (press right arrow until we find it)
  // Models order: fish, dolphin, manatee, kelp, food, foodAlt, logo
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/food-model.png', fullPage: true });

  // Next: foodAlt
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/food-alt-model.png', fullPage: true });

  // Also capture the overall scene with food particles
  await page.keyboard.press('1'); // back to narrative
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => window.__debug?.stageTimer > 15, { timeout: 120_000, polling: 1000 });
  await page.screenshot({ path: 'e2e/food-in-scene.png', fullPage: true });
});
