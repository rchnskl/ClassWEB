import { test, expect } from '@playwright/test';

// Golden-path + failure-path for the entry point every user session starts at.
// Uses accessible role/label locators throughout — this doubles as a live
// check that the WCAG label fixes actually work for real assistive tech APIs,
// not just axe's static analysis.

test.describe('Login', () => {
  test('rejects the wrong password with a visible error, without navigating away', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('อีเมล').fill('admin@nursing.au.edu');
    await page.getByLabel('รหัสผ่าน').fill('wrong-password-entirely');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();

    // Note: Next.js's own hidden route-announcer also carries role="alert"
    // (id=__next-route-announcer__, always present, empty text) — assert on
    // our visible error chip specifically, not the generic ARIA role.
    await expect(page.locator('.chip-danger')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('signs in with valid credentials and reaches the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('อีเมล').fill('admin@nursing.au.edu');
    await page.getByLabel('รหัสผ่าน').fill('ChangeMe!2026');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('admin@nursing.au.edu')).toBeVisible();
  });

  test('logout returns to the login page and blocks a back-navigation to authed pages', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('อีเมล').fill('admin@nursing.au.edu');
    await page.getByLabel('รหัสผ่าน').fill('ChangeMe!2026');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
