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

  test("protected route redirects to login with next param", async ({ page }) => {
    await page.goto("/goods-out");
    await expect(page).toHaveURL(/\/login\?next=%2Fgoods-out/);
  });
});
