import Link from "next/link";

import { Monogram } from "@/components/monogram";

const NAV = [
  { href: "/admin", label: "Agenda" },
  { href: "/admin/appointments/new", label: "New booking" },
  { href: "/admin/services", label: "Services" },
  { href: "/admin/barbers", label: "Barbers" },
  { href: "/admin/schedule", label: "Hours & time off" },
  { href: "/admin/settings", label: "Settings" },
] as const;

/**
 * Static shell only. It does not read the session: layouts are not a
 * security boundary in Next.js, so each page checks it with requireAdmin().
 */
export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
          <Link href="/admin" className="flex items-center gap-3" aria-label="Admin home">
            <Monogram size="sm" />
            <span className="font-display text-lg italic">Admin</span>
          </Link>
          <nav aria-label="Admin" className="flex flex-1 flex-wrap gap-x-5 gap-y-2 text-sm">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-muted hover:text-foreground" prefetch={false}>
              View site
            </Link>
            <form action="/admin/logout" method="post">
              <button type="submit" className="text-muted hover:text-foreground underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
