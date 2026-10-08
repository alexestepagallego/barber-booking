/**
 * Demo data based on the real Chane Barber shop. Shared by the seed script
 * and the integration tests so both work with the same shape of data.
 * Prices are placeholders.
 */
export const SHOP = {
  name: "Chane Barber",
  // Placeholders: configure the real ones from the admin panel.
  phone: "+34 600 000 000",
  address: "Calle Mayor 1, Spain",
  timezone: "Europe/Madrid",
  slotIntervalMinutes: 15,
  bookingHorizonDays: 60,
  minNoticeMinutes: 60,
  cancellationCutoffMinutes: 120,
} as const;

export const BARBERS = [
  {
    slug: "chane",
    name: "Chane",
    bio: "Founder. Classic cuts and straight-razor shaves.",
    sortOrder: 1,
  },
  { slug: "leo", name: "Leo", bio: "Fades and modern styles.", sortOrder: 2 },
] as const;

export const SERVICES = [
  { slug: "classic-cut", name: "Classic cut", durationMinutes: 30, priceCents: 1500, sortOrder: 1 },
  {
    slug: "cut-and-beard",
    name: "Cut + beard trim",
    durationMinutes: 45,
    priceCents: 2000,
    sortOrder: 2,
  },
  { slug: "beard-trim", name: "Beard trim", durationMinutes: 15, priceCents: 800, sortOrder: 3 },
  { slug: "fade", name: "Fade", durationMinutes: 40, priceCents: 1700, sortOrder: 4 },
  {
    slug: "razor-shave",
    name: "Straight-razor shave",
    durationMinutes: 30,
    priceCents: 1200,
    sortOrder: 5,
  },
] as const;

/** Monday (1) to Saturday (6), split shift. Wall-clock times in SHOP.timezone. */
export const WEEKLY_SHIFTS = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
  { weekday, startTime: "09:00", endTime: "13:30" },
  { weekday, startTime: "16:00", endTime: "20:00" },
]);
