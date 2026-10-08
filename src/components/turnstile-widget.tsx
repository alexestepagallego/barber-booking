"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Inlined at build time. Must be written literally for Next.js to replace it.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export const turnstileEnabled = Boolean(SITE_KEY);

/**
 * Cloudflare Turnstile widget. Renders nothing when no site key is
 * configured (local development). Each token is single-use, so the parent
 * bumps `resetSignal` after every submission attempt to get a fresh one.
 *
 * The widget is removed in the effect cleanup: Next.js keeps hidden routes
 * mounted with <Activity>, and a stale widget would keep a spent token.
 */
export function TurnstileWidget({
  onToken,
  resetSignal,
}: {
  onToken: (token: string | null) => void;
  resetSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!SITE_KEY || !scriptReady || !containerRef.current || !window.turnstile) return;
    const id = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      theme: "dark",
      callback: (token) => onTokenRef.current(token),
      "expired-callback": () => onTokenRef.current(null),
      "error-callback": () => onTokenRef.current(null),
    });
    widgetId.current = id;
    return () => {
      window.turnstile?.remove(id);
      widgetId.current = null;
      onTokenRef.current(null);
    };
  }, [scriptReady]);

  useEffect(() => {
    if (resetSignal === 0 || !widgetId.current) return;
    onTokenRef.current(null);
    window.turnstile?.reset(widgetId.current);
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} className="min-h-[65px]" />
    </>
  );
}
