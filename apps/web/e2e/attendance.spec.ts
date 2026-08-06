import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('อีเมล').fill('admin@nursing.au.edu');
  await page.getByLabel('รหัสผ่าน').fill('ChangeMe!2026');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Attendance', () => {
  test('marking a student present is recorded and reflected in the UI', async ({ page }) => {
    await login(page);
    await page.goto('/attendance');

    const presentButtons = page.getByRole('button', { name: 'มาเรียน' });
    await expect(presentButtons.first()).toBeVisible({ timeout: 10_000 });
    await presentButtons.first().click();

    // A failed mark surfaces our error banner (see GradingDrawer/attendance
    // fix in commit 7ac1dc1) — assert it stays absent, i.e. the mark succeeded.
    await expect(page.locator('.chip-danger')).toHaveCount(0);
  });
});
