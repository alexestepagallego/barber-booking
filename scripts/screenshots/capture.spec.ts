import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { devices, expect, test, type Page } from "@playwright/test";

import { E2E_ADMIN } from "../../e2e/env";
import { chooseCard, chooseFirstTime, chooseFutureDay } from "../../e2e/helpers";

const OUT = "docs/screenshots";

async function fillDetails(page: Page) {
  await page.getByLabel("Full name").fill("Ana García");
  await page.getByLabel("Email").fill(`ana.${Date.now()}@example.com`);
  await page.getByLabel("Phone").fill("600 123 456");
  await page.getByRole("checkbox", { name: /I agree/ }).check();
}

async function pickBooking(page: Page) {
  await page.goto("/book");
  await expect(page.getByRole("radio", { name: /Classic cut/ })).toBeEnabled();
  await chooseCard(page, "Service", "Cut + beard trim");
  await chooseCard(page, "Barber", "Chane");
  await chooseFutureDay(page);
  await chooseFirstTime(page, 2);
}

/** Next open day (Monday–Saturday) after today, as YYYY-MM-DD in Madrid. */
function nextOpenDay(): string {
  const date = new Date();
  do date.setDate(date.getDate() + 1);
  while (date.getDay() === 0);
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
}

test("public pages and the confirmation email", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  // Wait for the shop-front photo behind the hero, not just the page shell.
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>("header img");
    return Boolean(image?.complete && image.naturalWidth > 0);
  });
  await page.screenshot({ path: `${OUT}/landing.png` });

  await pickBooking(page);
  await fillDetails(page);
  await page.screenshot({ path: `${OUT}/booking.png`, fullPage: true });

  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /See you soon/ })).toBeVisible();
  await page.screenshot({ path: `${OUT}/confirmation.png` });

  const manage = await page.getByRole("link", { name: "Manage or cancel" }).getAttribute("href");
  await page.goto(manage!);
  await page.getByRole("button", { name: "Change time" }).click();
  await chooseFutureDay(page, 3);
  await chooseFirstTime(page, 4);
  await page.screenshot({ path: `${OUT}/manage.png`, fullPage: true });

  // The local file transport saved the confirmation email as HTML.
  await expect
    .poll(() => readdirSync(".mail").filter((f) => f.endsWith(".html")).length)
    .toBeGreaterThan(0);
  const latest = readdirSync(".mail")
    .filter((f) => f.includes("is-conf") && f.endsWith(".html"))
    .map((f) => path.join(".mail", f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
  await page.setViewportSize({ width: 680, height: 900 });
  await page.setContent(readFileSync(latest, "utf8"));
  await page.screenshot({ path: `${OUT}/email.png`, fullPage: true });
});

test("admin panel", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto(`/admin?date=${nextOpenDay()}`);
  await expect(page.getByRole("heading", { name: "Chane" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/admin-agenda.png`, fullPage: true });

  await page.getByRole("link", { name: /–/ }).first().click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/admin-appointment.png`, fullPage: true });
});

test("mobile booking", async ({ browser }) => {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    reducedMotion: "reduce",
    colorScheme: "dark",
    baseURL: test.info().project.use.baseURL,
  });
  const page = await context.newPage();
  await pickBooking(page);
  await page.getByRole("heading", { name: "Choose your moment" }).scrollIntoViewIfNeeded();
  await page.locator("#step-time").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/mobile.png` });
  await context.close();
});

test("booking flow GIF", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 700 },
    recordVideo: { dir: "test-results/video", size: { width: 1000, height: 700 } },
    reducedMotion: "reduce",
    colorScheme: "dark",
    baseURL: test.info().project.use.baseURL,
  });
  const page = await context.newPage();
  const pause = () => page.waitForTimeout(700);

  await page.goto("/book");
  await expect(page.getByRole("radio", { name: /Classic cut/ })).toBeEnabled();
  await pause();
  await chooseCard(page, "Service", "Fade");
  await pause();
  await chooseCard(page, "Barber", "No preference");
  await pause();
  await chooseFutureDay(page);
  await pause();
  await chooseFirstTime(page, 3);
  await pause();
  await fillDetails(page);
  await pause();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /See you soon/ })).toBeVisible();
  await page.waitForTimeout(1500);

  const video = page.video()!;
  await context.close();
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    await video.path(),
    "-vf",
    "fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse",
    "-loop",
    "0",
    `${OUT}/booking-flow.gif`,
  ]);
});
