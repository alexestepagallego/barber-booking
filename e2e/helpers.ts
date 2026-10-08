import { expect, type Page } from "@playwright/test";

let counter = 0;

/** A unique customer per test, so per-email rate limits never interfere. */
export function uniqueCustomer(prefix: string) {
  counter += 1;
  const id = `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  return { name: "Test Customer", email: `${id}@example.com`, phone: "600 123 456" };
}

/** Clicks the card of a radio-card group (the radio itself is visually hidden). */
export async function chooseCard(page: Page, group: string | RegExp, text: string | RegExp) {
  await page.getByRole("radiogroup", { name: group }).getByText(text).first().click();
}

/**
 * Picks an open day at least two days ahead, so the minimum notice never
 * gets in the way, whatever time the tests run at.
 */
export async function chooseFutureDay(page: Page, skipDays = 2) {
  const days = page.getByRole("radiogroup", { name: "Day" }).locator("input[type=radio]");
  await expect(days.first()).toBeAttached();
  const count = await days.count();
  for (let i = skipDays; i < count; i++) {
    const day = days.nth(i);
    if (await day.isEnabled()) {
      await day.locator("xpath=..").click();
      return day.inputValue();
    }
  }
  throw new Error("No open day found in the next two weeks");
}

/** Chooses the first available time and returns its ISO start. */
export async function chooseFirstTime(page: Page, index = 0) {
  const times = page.locator("input[name=time]");
  await expect(times.first()).toBeAttached();
  const time = times.nth(index);
  await time.locator("xpath=..").click();
  return time.inputValue();
}

export async function fillCustomerDetails(page: Page, customer: ReturnType<typeof uniqueCustomer>) {
  await page.getByLabel("Full name").fill(customer.name);
  await page.getByLabel("Email").fill(customer.email);
  await page.getByLabel("Phone").fill(customer.phone);
  await page.getByRole("checkbox", { name: /I agree/ }).check();
}

/** Goes through the whole public booking flow and returns the manage-page path. */
export async function bookThroughUi(page: Page, customer = uniqueCustomer("book")) {
  await page.goto("/book");
  // The first step stays disabled until the form has hydrated.
  await expect(page.getByRole("radio", { name: /Classic cut/ })).toBeEnabled();
  await chooseCard(page, "Service", "Classic cut");
  await chooseCard(page, "Barber", "Chane");
  await chooseFutureDay(page);
  await chooseFirstTime(page);
  await fillCustomerDetails(page, customer);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /See you soon/ })).toBeVisible();
  const href = await page.getByRole("link", { name: "Manage or cancel" }).getAttribute("href");
  expect(href).toMatch(/^\/manage\/[A-Za-z0-9_-]{43}$/);
  return href!;
}
