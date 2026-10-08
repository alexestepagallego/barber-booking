import { describe, expect, it } from "vitest";

import { buildIcs, escapeIcsText, foldIcsLine, formatIcsDate } from "@/lib/ics";

const event = {
  uid: "6f1c3c5e-6a0b-4c2f-9a57-3c4f3c2f1a10@barber-booking",
  sequence: 0,
  startsAt: new Date("2026-10-08T08:00:00Z"),
  endsAt: new Date("2026-10-08T08:45:00Z"),
  summary: "Cut + beard trim, Chane Barber",
  description: "With Chane.\nManage: https://example.com/manage/abc",
  location: "Calle Mayor 1; Sevilla",
  status: "confirmed" as const,
};

const now = new Date("2026-10-07T12:00:00Z");

describe("ics helpers", () => {
  it("formats instants as UTC basic format", () => {
    expect(formatIcsDate(new Date("2026-10-08T08:05:09.123Z"))).toBe("20261008T080509Z");
  });

  it("escapes special characters in text values", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds lines at 75 octets, with continuation lines starting with a space", () => {
    const folded = foldIcsLine(`DESCRIPTION:${"x".repeat(200)}`);
    const physical = folded.split("\r\n");

    expect(physical.length).toBeGreaterThan(2);
    expect(physical.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(physical.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(physical.map((line, i) => (i === 0 ? line : line.slice(1))).join("")).toBe(
      `DESCRIPTION:${"x".repeat(200)}`,
    );
  });

  it("never splits a multi-byte character when folding", () => {
    const folded = foldIcsLine(`SUMMARY:${"ñ".repeat(80)}`);
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(line).not.toContain("�");
    }
  });
});

describe("buildIcs", () => {
  it("builds a valid published event with CRLF line endings", () => {
    const ics = buildIcs(event, { now });

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("DTSTART:20261008T080000Z");
    expect(ics).toContain("DTEND:20261008T084500Z");
    expect(ics).toContain("DTSTAMP:20261007T120000Z");
    expect(ics).toContain("SUMMARY:Cut + beard trim\\, Chane Barber");
    expect(ics).toContain("LOCATION:Calle Mayor 1\\; Sevilla");
    expect(ics).toContain("STATUS:CONFIRMED");
  });

  it("marks cancellations so calendar apps remove the event", () => {
    const ics = buildIcs({ ...event, sequence: 2, status: "cancelled" }, { now });

    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain(`UID:${event.uid}`);
  });

  it("omits optional properties that are not provided", () => {
    const ics = buildIcs(
      { ...event, description: undefined, location: undefined, url: undefined },
      { now },
    );
    expect(ics).not.toContain("DESCRIPTION");
    expect(ics).not.toContain("LOCATION");
    expect(ics).not.toContain("URL");
  });
});
