/**
 * Shown on every page of the public demo. Rendered in the static shell:
 * NEXT_PUBLIC_DEMO_MODE is inlined at build time.
 */
export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return null;
  return (
    <div
      role="note"
      className="bg-foreground text-background px-4 py-2 text-center text-xs tracking-wide"
    >
      Portfolio demo: bookings are not real and all data resets every night.{" "}
      <a href="https://github.com/alexestepagallego/barber-booking" className="underline">
        Source code
      </a>
    </div>
  );
}
