import { test, expect } from '@playwright/test';

test('editor mode — layout, colliders, and properties panel', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  await page.waitForFunction(
    () => window.__debug?.scene != null,
    { timeout: 15_000 }
  );

  // Switch to editor mode (key '3')
  await page.keyboard.press('3');

  // Wait for editor mode to activate
  await page.waitForFunction(
    () => window.__debug?.modeManager?.currentMode?.name === 'editor',
    { timeout: 10_000 }
  );

  // Give it a moment to render
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'e2e/editor-overview.png', fullPage: true });
  console.log('Editor overview saved to e2e/editor-overview.png');

  // Programmatically select the fish (index 0)
  await page.evaluate(() => {
    const mode = window.__debug?.modeManager?.currentMode;
    if (mode && mode._selectEntity) mode._selectEntity(0);
  });

  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/editor-fish-selected.png', fullPage: true });
  console.log('Fish selected saved to e2e/editor-fish-selected.png');

  // Check properties panel appeared
  const panel = page.locator('#editor-props');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // Verify mouthOffset and mouthRadius fields exist
  const mouthOffsetInput = panel.locator('input[data-field="mouthOffset"]');
  const mouthRadiusInput = panel.locator('input[data-field="mouthRadius"]');
  const colorInput = panel.locator('input[data-color-field="color"]');

  await expect(mouthOffsetInput).toBeVisible();
  await expect(mouthRadiusInput).toBeVisible();
  await expect(colorInput).toBeVisible();

  console.log('mouthOffset value:', await mouthOffsetInput.inputValue());
  console.log('mouthRadius value:', await mouthRadiusInput.inputValue());
  console.log('color value:', await colorInput.inputValue());

  // Verify collider toggle exists
  const toggle = page.locator('#editor-collider-toggle');
  await expect(toggle).toBeVisible();
});
