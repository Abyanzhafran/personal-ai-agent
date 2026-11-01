import { expect, test } from '@playwright/test';

test('halaman pesanan menampilkan total', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.locator('[data-testid=order-total]')).toBeVisible();
});
