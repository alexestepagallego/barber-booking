import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { bookThroughUi } from "./helpers";

/**
 * Automated WCAG 2.1 A/AA checks with axe-core on every public page. Axe
 * finds roughly a third of real-world issues; the rest (focus order,
 * announcements) is covered by the journey tests and manual checks.
 */
async function seriousViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) }));
}

for (const path of ["/", "/book", "/privacy", "/admin/login"]) {
  test(`${path} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test("the manage page has no serious accessibility violations", async ({ page }) => {
  const manage = await bookThroughUi(page);
  await page.goto(manage);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});
