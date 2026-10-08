import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Monogram } from "@/components/monogram";
import { manageTokenSchema } from "@/lib/booking-schema";
import { localDate } from "@/server/booking/availability";
import { findAppointmentByManageToken } from "@/server/booking/manage-appointment";
import { getCatalogue } from "@/server/catalogue";
import { getDb } from "@/server/db/client";
import { toManageDto } from "@/server/http/manage-auth";

import { ManageBooking } from "./manage-booking";

// Static metadata on purpose: the token must never reach a <title>, and
// these pages must never be indexed. next.config.ts sends
// `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` for /manage/*,
// so the token does not leak through Referer headers or search engines.
export const metadata: Metadata = {
  title: "Your appointment",
  robots: { index: false, follow: false, nocache: true },
};

export default function ManagePage({ params }: PageProps<"/manage/[token]">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <header className="mb-12 flex flex-col items-center gap-4 text-center">
        <Link href="/" aria-label="Chane Barber home">
          <Monogram />
        </Link>
        <h1 className="font-display text-4xl italic sm:text-5xl">Your appointment</h1>
        <div className="bg-foreground h-px w-12" />
      </header>

      <Suspense fallback={<p className="text-muted text-center">Loading…</p>}>
        <ManageLoader params={params} />
      </Suspense>
    </main>
  );
}

/**
 * Reads the token, looks the booking up (uncached: it is secret and its
 * state changes) and hands a minimal DTO to the client.
 *
 * Unknown or malformed tokens render the not-found UI without revealing
 * anything. Because this runs inside <Suspense> after the static shell has
 * been streamed, that is a "soft 404": HTTP 200 plus a noindex tag. That is
 * an accepted trade-off of streaming; a real 404 would require a database
 * lookup before any byte is sent.
 */
async function ManageLoader({ params }: { params: PageProps<"/manage/[token]">["params"] }) {
  const { token } = await params;
  // Everything below depends on the request (current time, live data).
  await connection();
  if (!manageTokenSchema.safeParse(token).success) notFound();

  const details = await findAppointmentByManageToken(getDb(), token);
  if (!details) notFound();

  const catalogue = await getCatalogue();
  const closedWeekdays = catalogue.openingHours
    .filter((day) => day.ranges.length === 0)
    .map((day) => day.weekday);

  return (
    <ManageBooking
      token={token}
      initial={toManageDto(details)}
      shop={catalogue.shop}
      today={localDate(new Date(), catalogue.shop.timezone)}
      closedWeekdays={closedWeekdays}
    />
  );
}
