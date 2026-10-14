import type { Metadata } from "next";
import { Playfair_Display, Roboto } from "next/font/google";

import { DemoBanner } from "@/components/demo-banner";
import { IntroCurtain } from "@/components/intro-curtain";
import { INTRO_GATE_SCRIPT } from "@/components/intro-gate";

import "./globals.css";

const display = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const body = Roboto({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: { default: "Barber Booker", template: "%s · Barber Booker" },
  description: "Book your appointment at Barber Booker.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the gate script may set data-intro on <html>
    // before React hydrates.
    <html
      lang="en"
      className={`${display.variable} ${body.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_GATE_SCRIPT }} />
        <noscript dangerouslySetInnerHTML={{ __html: "<style>#bb-intro{display:none}</style>" }} />
      </head>
      <body className="flex min-h-full flex-col">
        <IntroCurtain />
        <DemoBanner />
        {children}
      </body>
    </html>
  );
}
