import type { Metadata } from "next";

// Nothing under /admin is ever indexed.
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Chane Barber" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
