import { expect, test, type Page } from "@playwright/test";

// The suite runs with reduced motion, which skips the intro. These tests opt
// back in to check that it plays, gets out of the way, and stays out of the
// way where it should.
test.use({ reducedMotion: "no-preference" });

type IntroTrace = { painted?: boolean; played?: boolean };

/**
 * Checks the curtain before every frame of each page load: whether it was
 * ever painted (not display: none) and whether its animation started. A
 * skipped intro must never reach the screen, not just be gone by the end.
 */
async function traceIntro(page: Page) {
  await page.addInitScript(() => {
    const trace: IntroTrace = {};
    (window as unknown as { introTrace: IntroTrace }).introTrace = trace;
    const check = () => {
      const curtain = document.getElementById("bb-intro");
      if (curtain && getComputedStyle(curtain).display !== "none") trace.painted = true;
      if (curtain?.dataset.state === "playing") trace.played = true;
      if (performance.now() < 4_000) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** The trace once the page has hydrated and the curtain is gone. */
async function introTrace(page: Page): Promise<IntroTrace> {
  await expect(page.locator("#bb-intro")).toHaveCount(0, { timeout: 6_000 });
  return page.evaluate(() => (window as unknown as { introTrace: IntroTrace }).introTrace);
}

test.describe("intro curtain", () => {
  test("plays once per tab, then leaves the page usable", async ({ page }) => {
    await traceIntro(page);
    await page.goto("/");
    expect(await introTrace(page)).toEqual({ painted: true, played: true });
    await expect(page.locator("[data-intro-target]")).toBeVisible();

    await page.getByRole("link", { name: "Book an appointment" }).click();
    await expect(page).toHaveURL(/\/book$/);

    // A second full page load in the same tab skips it before the first paint.
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-intro", "skip");
    expect(await introTrace(page)).toEqual({});
  });

  test("never covers the staff panel or a manage link", async ({ page }) => {
    await traceIntro(page);
    for (const path of ["/admin/login", "/manage/not-a-real-token"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-intro", "skip");
      expect(await introTrace(page)).toEqual({});
    }
  });

  test("is skipped when the visitor asks for reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await traceIntro(page);
    await page.goto("/");
    expect(await introTrace(page)).toEqual({});
    await expect(page.locator("[data-intro-target]")).toBeVisible();
  });
});
