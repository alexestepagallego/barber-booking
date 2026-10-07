"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A link that plays the shop-front intro video before navigating, like the
 * original Chane Barber site. It degrades to a plain link: no JavaScript,
 * "reduce motion" enabled, or a video that fails to start all navigate
 * straight away. The video can always be skipped.
 */
export function IntroLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    router.prefetch(href);
  }, [router, href]);

  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    const go = () => router.push(href);
    if (!video) return go();

    // If playback has not started shortly (slow network, autoplay blocked), skip it.
    const fallback = window.setTimeout(() => {
      if (video.currentTime === 0) go();
    }, 1500);
    video.play().catch(go);
    return () => window.clearTimeout(fallback);
  }, [playing, router, href]);

  return (
    <>
      <a
        href={href}
        className={className}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
          event.preventDefault();
          setPlaying(true);
        }}
      >
        {children}
      </a>

      {playing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <video
            ref={videoRef}
            src="/media/intro.mp4"
            poster="/media/shopfront.jpg"
            muted
            playsInline
            preload="auto"
            onEnded={() => router.push(href)}
            onError={() => router.push(href)}
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => router.push(href)}
            className="absolute right-4 bottom-6 rounded-full border border-white/40 bg-black/40 px-5 py-2 text-xs tracking-[0.2em] text-white uppercase backdrop-blur hover:bg-white hover:text-black"
            autoFocus
          >
            Skip
          </button>
        </div>
      )}
    </>
  );
}
