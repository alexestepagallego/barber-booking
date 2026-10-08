import { expect, test, type Page } from "@playwright/test";

import { E2E_ADMIN } from "./env";
import { chooseFirstTime } from "./helpers";

async function signIn(page: Page, password = E2E_ADMIN.password) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (password === E2E_ADMIN.password) await expect(page).toHaveURL(/\/admin$/);
}

/** A weekday at least two days ahead, as YYYY-MM-DD in Madrid time. */
function futureWeekday(): string {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  while (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
}

test.describe("admin panel", () => {
  test("is not reachable without signing in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin/services");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("rejects a wrong password without saying which part was wrong", async ({ page }) => {
    await signIn(page, "definitely not the password");
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("staff book a walk-in, see it in the agenda and cancel it", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Chane" })).toBeVisible();

    await page.getByRole("link", { name: "New booking" }).click();
    await page.getByLabel("Service").selectOption({ label: "Classic cut (30 min)" });
    const day = futureWeekday();
    await page.getByLabel("Day", { exact: true }).fill(day);
    await chooseFirstTime(page);
    await page.getByLabel("Customer name").fill("Walk In");
    await page.getByLabel("Phone").fill("600111222");
    await page.getByRole("button", { name: "Book appointment" }).click();

    await expect(page).toHaveURL(/\/admin\/appointments\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByRole("status").first()).toHaveText(/Booked/);
    await expect(page.getByRole("heading", { name: "Walk In" })).toBeVisible();

    await page.getByRole("link", { name: /Back to/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?date=${day}$`));
    await expect(page.getByRole("link", { name: /Walk In/ })).toBeVisible();

    await page.getByRole("link", { name: /Walk In/ }).click();
    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Appointment cancelled." }),
    ).toBeVisible();
    await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
  });

  test("a price change shows up on the public site straight away", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/services");
    const form = page.locator("form").filter({ has: page.locator('input[value="Beard trim"]') });
    await form.getByLabel("Price (€)").fill("9.5");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByRole("status")).toHaveText('Saved "Beard trim".');

    await page.goto("/");
    await expect(page.getByText("€9.50")).toBeVisible();
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
