import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";

import { IntroLink } from "@/components/intro-link";
import { Monogram } from "@/components/monogram";
import { formatDuration, formatPrice, WEEKDAY_NAMES } from "@/lib/format";
import { getCatalogue } from "@/server/catalogue";

import shopfront from "../../public/media/shopfront.jpg";

export default function Home() {
  return (
    <>
      <header className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 text-center">
        <Image
          src={shopfront}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="100vw"
          className="object-cover opacity-35 blur-[2px]"
        />
        <div className="from-background/30 via-background/60 to-background absolute inset-0 bg-gradient-to-b" />

        <div className="relative flex flex-col items-center gap-6">
          <Monogram size="lg" />
          <p className="text-muted text-xs tracking-[0.35em] uppercase">Gentlemen&apos;s barber</p>
          <h1 className="font-display text-6xl italic sm:text-8xl">Chane Barber</h1>
          <div className="bg-foreground h-px w-16" />
          <p className="text-muted max-w-sm font-light">Where your best occasion begins.</p>
          <IntroLink
            href="/book"
            className="bg-foreground text-background hover:bg-background hover:text-foreground border-foreground mt-4 border px-10 py-4 text-sm tracking-[0.25em] uppercase transition-colors"
          >
            Book an appointment
          </IntroLink>
        </div>

        <a
          href="#services"
          className="text-muted hover:text-foreground absolute bottom-8 text-xs tracking-[0.3em] uppercase"
        >
          Discover ↓
        </a>
      </header>

      <main id="services" className="mx-auto w-full max-w-4xl px-4 py-24">
        <Suspense fallback={<p className="text-muted text-center">Loading…</p>}>
          <ShopDetails />
        </Suspense>
      </main>

      <footer className="border-border text-muted border-t px-4 py-10 text-center text-xs">
        © Chane Barber · Demo project built with Next.js and PostgreSQL ·{" "}
        <a
          href="https://github.com/alexestepagallego/barber-booking"
          className="hover:text-foreground underline"
        >
          Source code
        </a>
      </footer>
    </>
  );
}

async function ShopDetails() {
  await connection();
  const { services, barbers, openingHours } = await getCatalogue();

  return (
    <div className="grid gap-20">
      <Section title="Services">
        <ul className="divide-border border-border divide-y border-y">
          {services.map((service) => (
            <li key={service.id} className="flex items-baseline justify-between gap-4 py-5">
              <div>
                <p className="font-display text-xl">{service.name}</p>
                <p className="text-muted text-sm">{formatDuration(service.durationMinutes)}</p>
              </div>
              <p className="font-light tabular-nums">{formatPrice(service.priceCents)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="The team">
        <ul className="grid gap-6 sm:grid-cols-2">
          {barbers.map((barber) => (
            <li key={barber.id} className="border-border bg-surface border p-6">
              <p className="font-display text-2xl italic">{barber.name}</p>
              {barber.bio && <p className="text-muted mt-2 text-sm">{barber.bio}</p>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Opening hours">
        <dl className="mx-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-8 gap-y-3 text-sm">
          {openingHours.map(({ weekday, ranges }) => (
            <div key={weekday} className="contents">
              <dt className="text-muted">{WEEKDAY_NAMES[weekday - 1]}</dt>
              <dd className="text-right tabular-nums">
                {ranges.length === 0
                  ? "Closed"
                  : ranges.map((r) => `${r.start}–${r.end}`).join(" · ")}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <div className="text-center">
        <IntroLink
          href="/book"
          className="border-foreground hover:bg-foreground hover:text-background inline-block border px-10 py-4 text-sm tracking-[0.25em] uppercase transition-colors"
        >
          Book now
        </IntroLink>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display mb-8 text-center text-4xl italic">{title}</h2>
      {children}
    </section>
  );
}
