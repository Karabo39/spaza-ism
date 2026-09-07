import { test, expect } from "@playwright/test";

test.describe("public routing & auth gate", () => {
  test("unauthenticated users are redirected to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("login page renders the credential form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByPlaceholder("you@shop.co.za")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("signup page is reachable", async ({ page }) => {
    await page.goto("/signup");
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
  });

  test("password recovery is reachable on a narrow screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(
      page.getByRole("heading", { name: "Reset your password" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("a return receipt cannot be viewed without signing in", async ({
    page,
  }) => {
    await page.goto("/returns/00000000-0000-0000-0000-000000000001/receipt");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("back navigation returns from signup to login", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup/);
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("link", { name: "POS INVENTORY home" }),
    ).toBeVisible();
  });

  test("new operations require a signed-in user", async ({ page }) => {
    for (const route of [
      "imports",
      "orders",
      "invoices",
      "returns",
      "operations",
      "settings",
    ]) {
      await page.goto(`/${route}`);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=%2F${route}`));
    }
  });

  test("protected route redirects to login with next param", async ({
    page,
  }) => {
    await page.goto("/goods-out");
    await expect(page).toHaveURL(/\/login\?next=%2Fgoods-out/);
  });
});
