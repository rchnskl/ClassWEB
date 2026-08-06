import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('อีเมล').fill('admin@nursing.au.edu');
  await page.getByLabel('รหัสผ่าน').fill('ChangeMe!2026');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Assessment / grading', () => {
  test('the section picker has an accessible name (regression guard for the axe fix)', async ({ page }) => {
    await login(page);
    await page.goto('/assessment');
    // Was previously an unlabeled <select> — axe flagged it as a critical
    // "select-name" violation (fixed in commit 1eb06f1). This locator only
    // resolves at all if the accessible name is present.
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('opening the grading drawer, rating an item, and saving succeeds with no error banner', async ({ page }) => {
    await login(page);
    await page.goto('/assessment');

    await page.getByRole('button', { name: 'ให้คะแนน' }).first().click();
    await expect(page.getByRole('button', { name: 'ปิด' })).toBeVisible();

    // Rate the first rubric item's first criterion at 4/5.
    await page.getByRole('button', { name: '4', exact: true }).first().click();
    await page.getByRole('button', { name: 'บันทึก' }).click();

    // A failed save now surfaces a visible .chip-danger banner (commit
    // 7ac1dc1) instead of failing silently — assert it never appears.
    // (Not getByRole('alert'): Next.js's own hidden route-announcer element
    // also carries role="alert" and is always present in the DOM.)
    await expect(page.locator('.chip-danger')).toHaveCount(0);
  });
});
