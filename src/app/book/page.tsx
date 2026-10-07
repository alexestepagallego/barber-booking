import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Monogram } from "@/components/monogram";
import { localDate } from "@/server/booking/availability";
import { getCatalogue } from "@/server/catalogue";

import { BookingFlow } from "./booking-flow";

export const metadata: Metadata = { title: "Book an appointment" };

export default function BookPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <header className="mb-12 flex flex-col items-center gap-4 text-center">
        <Link href="/" aria-label="Chane Barber home">
          <Monogram />
        </Link>
        <h1 className="font-display text-4xl italic sm:text-5xl">Choose your moment</h1>
        <div className="bg-foreground h-px w-12" />
      </header>

      <Suspense fallback={<p className="text-muted text-center">Loading…</p>}>
        <BookingLoader />
      </Suspense>
    </main>
  );
}

async function BookingLoader() {
  await connection();
  const catalogue = await getCatalogue();
  // "Today" comes from the server clock in the shop's time zone, never from the browser.
  const today = localDate(new Date(), catalogue.shop.timezone);
  return <BookingFlow catalogue={catalogue} today={today} />;
}
