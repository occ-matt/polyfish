import { test, expect } from '@playwright/test';

test('camera controller — FPS default + screensaver toggle', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  await page.waitForFunction(
    () => window.__debug?.scene != null,
    { timeout: 15_000 }
  );

  // Wait for fish to spawn
  await page.waitForFunction(
    () => window.__debug?.stageTimer > 12,
    { timeout: 120_000, polling: 1000 }
  );

  // Verify FPS mode is default
  const initialMode = await page.evaluate(() => {
    return window.__debug?.cameraController?.mode;
  });
  console.log(`Initial camera mode: ${initialMode}`);
  expect(initialMode).toBe('fps');

  // Screenshot in FPS mode
  await page.screenshot({ path: 'e2e/camera-fps.png', fullPage: true });

  // Toggle to screensaver via Tab
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  const afterToggle = await page.evaluate(() => {
    return window.__debug?.cameraController?.mode;
  });
  console.log(`After Tab: ${afterToggle}`);
  expect(afterToggle).toBe('screensaver');

  // Let screensaver run for a few seconds
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'e2e/camera-screensaver.png', fullPage: true });

  // Toggle back to FPS
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);

  const backToFps = await page.evaluate(() => {
    return window.__debug?.cameraController?.mode;
  });
  console.log(`After second Tab: ${backToFps}`);
  expect(backToFps).toBe('fps');

  expect(errors, 'No uncaught exceptions').toHaveLength(0);
  console.log('Screenshots: e2e/camera-fps.png, e2e/camera-screensaver.png');
});
