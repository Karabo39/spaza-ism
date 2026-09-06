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
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });

  test("back navigation returns from signup to login", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup/);
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("link", { name: "Spaza ISM home" })).toBeVisible();
  });

  test("new operations require a signed-in user", async ({ page }) => {
    for (const route of ["imports","orders","invoices","returns","operations","settings"]) {
      await page.goto(`/${route}`);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=%2F${route}`));
    }
  });

  test("protected route redirects to login with next param", async ({ page }) => {
    await page.goto("/goods-out");
    await expect(page).toHaveURL(/\/login\?next=%2Fgoods-out/);
  });
});
