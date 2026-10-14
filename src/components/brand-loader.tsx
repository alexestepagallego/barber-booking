import { LETTERS, MONOGRAM_VIEWBOX, RING } from "./brand-mark";

/**
 * Suspense fallback: the BB monogram with a ring that keeps drawing itself.
 * It fades in after 350 ms (CSS), past React's 300 ms minimum fallback
 * time, so loads that finish within it never flash it.
 */
export function BrandLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="bb-loader flex justify-center py-12">
      <svg
        viewBox={MONOGRAM_VIEWBOX}
        className="h-16 w-16 overflow-visible"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={RING.cx}
          cy={RING.cy}
          r={RING.r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1.5}
        />
        <circle
          className="bb-loader-ring"
          cx={RING.cx}
          cy={RING.cy}
          r={RING.r}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <path className="bb-loader-letters" d={LETTERS.flat().join("")} fill="currentColor" />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}
