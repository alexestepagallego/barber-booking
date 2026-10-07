import { describe, expect, it } from "vitest";

import { createBookingSchema } from "@/lib/booking-schema";

const valid = {
  serviceId: "6f1c3c5e-6a0b-4c2f-9a57-3c4f3c2f1a10",
  barberId: null,
  startsAt: "2030-06-03T10:00:00+02:00",
  customerName: "  Ana García  ",
  customerEmail: "  Ana@Example.COM ",
  customerPhone: "+34 600 00 00 00",
  privacyAccepted: true,
};

describe("createBookingSchema", () => {
  it("normalises valid input", () => {
    const parsed = createBookingSchema.parse(valid);

    expect(parsed.customerName).toBe("Ana García");
    expect(parsed.customerEmail).toBe("ana@example.com");
    expect(parsed.customerPhone).toBe("+34600000000");
    expect(parsed.startsAt).toEqual(new Date("2030-06-03T08:00:00Z"));
  });

  it.each([
    ["customerName", "A"],
    ["customerEmail", "not-an-email"],
    ["customerPhone", "12345"],
    ["customerPhone", "call me"],
    ["privacyAccepted", false],
    ["serviceId", "classic-cut"],
    ["barberId", "chane"],
    ["startsAt", "2030-06-03 10:00"],
    // Without an offset the time would be interpreted in the server's zone.
    ["startsAt", "2030-06-03T10:00:00"],
  ])("rejects an invalid %s (%s)", (field, value) => {
    const result = createBookingSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("rejects unexpected types instead of coercing them", () => {
    expect(createBookingSchema.safeParse({ ...valid, privacyAccepted: "true" }).success).toBe(
      false,
    );
    expect(createBookingSchema.safeParse({ ...valid, customerName: 42 }).success).toBe(false);
  });
});
