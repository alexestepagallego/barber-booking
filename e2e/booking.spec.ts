import { expect, test } from "@playwright/test";

import {
  bookThroughUi,
  chooseCard,
  chooseFirstTime,
  chooseFutureDay,
  fillCustomerDetails,
  uniqueCustomer,
} from "./helpers";

test.describe("customer journey", () => {
  test("from the landing page to a confirmed booking", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Chane Barber" })).toBeVisible();
    await expect(page.getByText("Classic cut").first()).toBeVisible();

    // Reduced motion is on, so the intro video is skipped.
    await page.getByRole("link", { name: "Book an appointment" }).click();
    await expect(page).toHaveURL(/\/book$/);

    const manage = await bookThroughUi(page);
    expect(manage).toBeTruthy();
  });

  test("the form explains what is wrong and keeps what was typed", async ({ page }) => {
    await page.goto("/book");
    await expect(page.getByRole("radio", { name: /Classic cut/ })).toBeEnabled();
    await chooseCard(page, "Service", "Fade");
    await chooseCard(page, "Barber", "No preference");
    await chooseFutureDay(page);
    await chooseFirstTime(page);

    await page.getByLabel("Full name").fill("Ana");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Confirm booking" }).click();

    await expect(page.getByText("Please enter a valid email address")).toBeVisible();
    await expect(page.getByText("Please enter a valid phone number")).toBeVisible();
    await expect(page.getByText("You need to accept the privacy policy")).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("Ana");
  });

  test("manage link: move the appointment, then cancel it", async ({ page }) => {
    const manage = await bookThroughUi(page);
    await page.goto(manage);
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Change time" }).click();
    await expect(page.getByRole("heading", { name: "Choose a new time" })).toBeFocused();
    await chooseFutureDay(page, 3);
    await chooseFirstTime(page, 1);
    await page.getByRole("button", { name: /^Move to/ }).click();
    await expect(page.getByRole("status")).toHaveText(/has been moved/);

    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(page.getByRole("heading", { name: "Cancel this appointment?" })).toBeFocused();
    await page.getByRole("button", { name: "Yes, cancel it" }).click();
    await expect(page.getByRole("status")).toHaveText("Your appointment has been cancelled.");
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Book another time" })).toBeVisible();

    // The link keeps working, but there is nothing left to change.
    await page.reload();
    await expect(page.getByRole("button", { name: "Change time" })).toHaveCount(0);
  });

  test("unknown manage links show the not-found page", async ({ page }) => {
    await page.goto(`/manage/${"x".repeat(43)}`);
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  });
});

test.describe("double booking from the UI", () => {
  test("someone else takes the time while the form is being filled in", async ({ page }) => {
    await page.goto("/book");
    await expect(page.getByRole("radio", { name: /Classic cut/ })).toBeEnabled();
    await chooseCard(page, "Service", "Classic cut");
    await chooseCard(page, "Barber", "Leo");
    await chooseFutureDay(page);
    const startsAt = await chooseFirstTime(page);
    const customer = uniqueCustomer("slow");
    await fillCustomerDetails(page, customer);

    // Another customer books exactly that slot through the API first.
    const serviceId = await page.locator("input[name=service]:checked").inputValue();
    const barberId = await page.locator("input[name=barber]:checked").inputValue();
    const other = uniqueCustomer("fast");
    const response = await page.request.post("/api/appointments", {
      data: {
        serviceId,
        barberId,
        startsAt,
        customerName: other.name,
        customerEmail: other.email,
        customerPhone: other.phone,
        privacyAccepted: true,
      },
    });
    expect(response.status()).toBe(201);

    await page.getByRole("button", { name: "Confirm booking" }).click();

    await expect(page.getByText(/that time is no longer available/)).toBeVisible();
    // The taken time disappeared from the refreshed list…
    await expect(page.locator(`input[name=time][value="${startsAt}"]`)).toHaveCount(0);
    // …and nothing the customer typed was lost.
    await expect(page.getByLabel("Email")).toHaveValue(customer.email);
  });
});
