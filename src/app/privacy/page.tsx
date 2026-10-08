import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Monogram } from "@/components/monogram";
import { getCatalogue } from "@/server/catalogue";
import { retentionDays } from "@/server/config";

export const metadata: Metadata = { title: "Privacy policy" };

/**
 * Privacy notice for the booking system (GDPR art. 13). Facts that depend on
 * configuration (shop name and contact, retention period) are read live, so
 * the notice never contradicts what the system actually does.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <header className="mb-12 flex flex-col items-center gap-4 text-center">
        <Link href="/" aria-label="Chane Barber home">
          <Monogram />
        </Link>
        <h1 className="font-display text-4xl italic sm:text-5xl">Privacy policy</h1>
        <div className="bg-foreground h-px w-12" />
      </header>
      <Suspense fallback={<p className="text-muted text-center">Loading…</p>}>
        <Policy />
      </Suspense>
    </main>
  );
}

async function Policy() {
  await connection();
  const { shop } = await getCatalogue();
  const days = retentionDays();

  return (
    <article className="[&_h2]:font-display [&_h2]:text-foreground [&_p]:text-muted [&_li]:text-muted grid gap-8 text-sm leading-7 [&_h2]:text-2xl">
      <section className="grid gap-2">
        <h2>Who is responsible</h2>
        <p>
          {shop.name}
          {shop.address ? `, ${shop.address}` : ""}
          {shop.phone ? ` (${shop.phone})` : ""} is responsible for the personal data collected when
          you book an appointment on this website.
        </p>
      </section>

      <section className="grid gap-2">
        <h2>What we collect and why</h2>
        <ul className="list-disc pl-5">
          <li>Your name, email address and phone number, to book and manage your appointment.</li>
          <li>The service, barber and time you chose, and any later changes or cancellations.</li>
          <li>
            Your IP address, briefly, to limit abuse (too many requests) and to check that the
            request comes from a person and not a bot.
          </li>
        </ul>
        <p>
          We use your data only to provide the appointment you asked for (GDPR art. 6.1.b): the
          confirmation, a reminder the day before and any notice about changes. We do not send
          marketing and do not sell or share your data.
        </p>
      </section>

      <section className="grid gap-2">
        <h2>Who processes it for us</h2>
        <ul className="list-disc pl-5">
          <li>Vercel (hosting) and Neon (database), to run the website.</li>
          <li>Resend, to deliver the emails about your appointment.</li>
          <li>Cloudflare Turnstile, to tell people from bots without tracking cookies.</li>
        </ul>
      </section>

      <section className="grid gap-2">
        <h2>How long we keep it</h2>
        <p>
          Your name, email and phone number are erased automatically {days} days after your
          appointment. The appointment itself is kept without personal data for our records.
        </p>
      </section>

      <section className="grid gap-2">
        <h2>Cookies</h2>
        <p>
          The public pages set no tracking or advertising cookies. Staff who sign in to the admin
          panel receive a session cookie that is only sent to the admin pages.
        </p>
      </section>

      <section className="grid gap-2">
        <h2>Your rights</h2>
        <p>
          You can cancel your appointment online with the link in your confirmation email, until the
          deadline shown there. You can also ask us to access, correct or erase your data
          {shop.phone ? ` by calling ${shop.phone}` : ""}, and you may complain to your data
          protection authority (in Spain, the AEPD).
        </p>
      </section>
    </article>
  );
}
