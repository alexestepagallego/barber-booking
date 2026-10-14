"use client";

import { useEffect, useRef, useState } from "react";

import { LETTERS, MONOGRAM_VIEWBOX, RING, RING_HALVES, RING_ORIGIN } from "./brand-mark";
import { INTRO_SEEN_KEY } from "./intro-gate";

type Gsap = typeof import("gsap").gsap;

/**
 * Ready this late (hydration plus loading GSAP), the page has waited long
 * enough: no show. Kept under the 3 s CSS failsafe, so JavaScript never takes
 * over a curtain that has started fading on its own.
 */
const LATE_MS = 2000;
/** From navigation start: whatever happens to the animation, the page shows by then. */
const HARD_CAP_MS = 6000;

/**
 * The entry curtain, adapted from puntozerosl.es. On a black screen the BB
 * monogram draws itself with GSAP: the ring grows from a dot at the top in
 * both directions, each B is drawn in outline and then filled, it glows
 * once, and lands exactly on the page's own monogram while the curtain
 * fades. About two seconds, once per tab.
 *
 * It lives in the root layout, so it plays on a full page load and never on
 * client-side navigation. Because it covers the whole page:
 * - The inline gate script skips it before the first paint (staff panel,
 *   manage links, already seen in this tab), and CSS skips it for reduced
 *   motion and when JavaScript is off.
 * - If it is ready late, GSAP fails to load or the animation stalls, it
 *   fades away. In a hidden tab or a prerender it does not play at all.
 * - Until JavaScript takes over, a CSS failsafe fades it out after 3 s.
 * GSAP is imported on demand, so pages that skip the intro never load it.
 */
export function IntroCurtain() {
  const [done, setDone] = useState(false);
  const curtainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const curtain = curtainRef.current;
    if (!curtain) return;
    let stopped = false;
    let cancelled = false;
    let cap = 0;
    let revert = () => {};

    const onVisibilityChange = () => {
      // A hidden tab freezes the timeline; nobody is watching, so end it.
      if (document.visibilityState === "hidden") finish();
    };
    const stop = () => {
      stopped = true;
      window.clearTimeout(cap);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    const finish = () => {
      stop();
      setDone(true);
    };
    // Fades out from wherever it is, including halfway through the CSS failsafe.
    const leave = () => {
      if (stopped) return;
      stop();
      const { opacity, visibility } = getComputedStyle(curtain);
      if (visibility === "hidden") return setDone(true);
      curtain.style.opacity = opacity;
      curtain.dataset.state = "leaving";
      curtain.getBoundingClientRect(); // commit the start value of the transition
      curtain.style.opacity = "0";
      window.setTimeout(() => setDone(true), 400);
    };

    if (
      document.documentElement.dataset.intro === "skip" ||
      document.visibilityState !== "visible" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // A background tab or a prerender is not marked as seen: the intro can
      // still play on a later, visible load in this tab.
      finish();
      return;
    }
    try {
      sessionStorage.setItem(INTRO_SEEN_KEY, "1");
    } catch {
      // Storage blocked: the intro plays again on the next page load.
    }
    if (performance.now() > LATE_MS) {
      leave();
      return;
    }

    cap = window.setTimeout(leave, Math.max(0, HARD_CAP_MS - performance.now()));
    document.addEventListener("visibilitychange", onVisibilityChange);

    Promise.all([import("gsap"), import("gsap/DrawSVGPlugin")])
      .then(([{ gsap }, { DrawSVGPlugin }]) => {
        if (cancelled || stopped) return;
        // Downloading GSAP counts towards the wait too.
        if (performance.now() > LATE_MS) return leave();
        gsap.registerPlugin(DrawSVGPlugin);
        // JavaScript takes over: this switches the CSS failsafe off, hides
        // the monogram it will land on and locks scrolling (globals.css).
        curtain.dataset.state = "playing";
        const ctx = gsap.context(() => play(gsap, curtain, finish), curtain);
        revert = () => ctx.revert();
      })
      .catch(leave);

    return () => {
      cancelled = true;
      stop();
      revert();
    };
  }, []);

  if (done) return null;

  return (
    <div id="bb-intro" ref={curtainRef} aria-hidden="true">
      <div className="bb-intro-backdrop" />
      <div className="bb-intro-stage">
        <div className="bb-intro-glow" />
        <svg className="bb-intro-logo" viewBox={MONOGRAM_VIEWBOX} focusable="false">
          {/* The starting point, on screen from the first paint (CSS). */}
          <circle
            className="bb-intro-origin"
            cx={RING_ORIGIN.x}
            cy={RING_ORIGIN.y}
            r={2.4}
            fill="currentColor"
          />
          <g className="bb-intro-draw" fill="none" stroke="currentColor">
            {RING_HALVES.map((d) => (
              <path key={d} className="bb-intro-ring" d={d} strokeWidth={RING.strokeWidth} />
            ))}
            {LETTERS.map((contours, i) => (
              <g key={i} className="bb-intro-letter">
                <path
                  className="bb-intro-fill"
                  d={contours.join("")}
                  fill="currentColor"
                  fillOpacity={0}
                  stroke="none"
                />
                {contours.map((d) => (
                  <path key={d} className="bb-intro-outline" d={d} strokeWidth={0.35} />
                ))}
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

/** The drawing, on the same rhythm as the puntozerosl.es timeline. */
function play(gsap: Gsap, curtain: HTMLElement, finish: () => void) {
  const q = gsap.utils.selector(curtain);
  gsap.set(q(".bb-intro-ring, .bb-intro-outline"), { drawSVG: "0%" });
  gsap.set(q(".bb-intro-draw"), { visibility: "visible" });

  const tl = gsap.timeline();
  // The ring grows from the dot in both directions and closes at the bottom.
  tl.to(q(".bb-intro-ring"), { drawSVG: "100%", duration: 0.85, ease: "power2.inOut" }, 0.05);
  // Once both halves have left it, the dot melts into the ring. Its radius
  // shrinks rather than a transform, which would fight the CSS pop-in.
  tl.to(q(".bb-intro-origin"), { attr: { r: 0 }, duration: 0.3, ease: "power2.in" }, 0.7);
  // Each B is drawn in outline, the second a beat after the first, then filled.
  q(".bb-intro-letter").forEach((letter, i) => {
    tl.to(
      letter.querySelectorAll(".bb-intro-outline"),
      { drawSVG: "100%", duration: 0.8, ease: "power2.inOut" },
      0.3 + i * 0.12,
    );
  });
  tl.to(q(".bb-intro-fill"), { fillOpacity: 1, duration: 0.35, ease: "power1.out" }, 1.0);
  tl.to(q(".bb-intro-outline"), { strokeOpacity: 0, duration: 0.35, ease: "power1.out" }, 1.05);
  // One short glow when it is complete.
  tl.to(
    q(".bb-intro-glow"),
    { opacity: 0.38, scale: 1.1, duration: 0.3, ease: "power2.out" },
    1.15,
  );
  tl.to(q(".bb-intro-glow"), { opacity: 0, duration: 0.45, ease: "power2.in" }, 1.45);
  tl.add(() => land(gsap, curtain, finish), 1.55);
}

/**
 * Flies the logo onto the page's monogram ([data-intro-target], hidden
 * meanwhile by CSS) while the backdrop fades, so when the curtain goes the
 * real monogram is already in place. Without a visible target, the curtain
 * lifts instead, as in the PuntoZero CRM.
 */
function land(gsap: Gsap, curtain: HTMLElement, finish: () => void) {
  const stage = curtain.querySelector<HTMLElement>(".bb-intro-stage");
  const backdrop = curtain.querySelector<HTMLElement>(".bb-intro-backdrop");
  const target = document.querySelector("[data-intro-target]")?.getBoundingClientRect();
  if (!stage || !backdrop) return finish();
  // The page is about to show: clicks go through from now on.
  curtain.style.pointerEvents = "none";

  if (target && target.width > 0 && target.top >= 0 && target.bottom <= window.innerHeight) {
    const from = stage.getBoundingClientRect();
    gsap.to(stage, {
      x: target.left + target.width / 2 - (from.left + from.width / 2),
      y: target.top + target.height / 2 - (from.top + from.height / 2),
      scale: target.width / from.width,
      duration: 0.7,
      ease: "power3.inOut",
      onComplete: finish,
    });
    gsap.to(backdrop, { opacity: 0, duration: 0.55, delay: 0.1, ease: "power2.inOut" });
  } else {
    gsap.to(stage, { scale: 1.06, opacity: 0, duration: 0.4, ease: "power2.in" });
    gsap.to(curtain, {
      yPercent: -100,
      duration: 0.6,
      delay: 0.08,
      ease: "power3.inOut",
      onComplete: finish,
    });
  }
}
