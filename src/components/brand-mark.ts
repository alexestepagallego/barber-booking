/**
 * The BB monogram as SVG geometry, so it can be drawn stroke by stroke.
 *
 * It matches <Monogram size="lg" /> exactly: a 96 px box with a 1 px ring,
 * and "BB" in Playfair Display at 30 px with tight tracking. The letters
 * are the real glyph outlines from the font the app ships (Regular, weight
 * 400), placed where the browser draws the text. An SVG of this viewBox
 * drawn over the HTML monogram therefore lines up with it, which is what
 * lets the intro logo land on the page's monogram without a jump.
 */
export const MONOGRAM_VIEWBOX = "0 0 96 96";

/** The ring, as the CSS border draws it: centred on the 1 px border. */
export const RING = { cx: 48, cy: 48, r: 47.5, strokeWidth: 1 };

/** Where the ring starts drawing: its top point. */
export const RING_ORIGIN = { x: 48, y: 0.5 };

/** The ring as two halves, both starting at the top and closing at the bottom. */
export const RING_HALVES = ["M48 0.5A47.5 47.5 0 0 0 48 95.5", "M48 0.5A47.5 47.5 0 0 1 48 95.5"];

/**
 * Each letter as its two contours: the outer shape, then the counters (the
 * font joins both holes of the B into one contour).
 */
export const LETTERS = [
  [
    "M31.32 38.76Q31.95 38.79 32.97 38.82Q33.99 38.85 34.98 38.85Q36.39 38.85 37.68 38.82Q38.97 38.79 39.51 38.79Q42.66 38.79 44.25 40.11Q45.84 41.43 45.84 43.5Q45.84 44.55 45.41 45.56Q44.97 46.56 43.97 47.39Q42.96 48.21 41.28 48.72L41.28 48.78Q43.65 49.08 44.99 49.91Q46.32 50.73 46.86 51.84Q47.4 52.95 47.4 54.18Q47.4 55.89 46.55 57.2Q45.69 58.5 44.07 59.25Q42.45 60 40.2 60Q39.54 60 38.22 59.96Q36.9 59.91 35.04 59.91Q33.99 59.91 32.97 59.93Q31.95 59.94 31.32 60L31.32 59.4Q32.34 59.34 32.87 59.16Q33.39 58.98 33.57 58.44Q33.75 57.9 33.75 56.82L33.75 41.94Q33.75 40.83 33.57 40.31Q33.39 39.78 32.87 39.59Q32.34 39.39 31.32 39.36Z",
    "M38.76 39.36Q37.38 39.36 36.96 39.87Q36.54 40.38 36.54 41.94L36.54 56.82Q36.54 57.87 36.72 58.41Q36.9 58.95 37.38 59.13Q37.86 59.31 38.79 59.31Q41.73 59.31 43.07 57.95Q44.4 56.58 44.4 54.06Q44.4 51.75 43.16 50.49Q41.91 49.23 39.06 49.23L35.97 49.23Q35.97 49.23 35.97 48.98Q35.97 48.72 35.97 48.72L38.55 48.72Q40.32 48.72 41.28 48.05Q42.24 47.37 42.6 46.25Q42.96 45.12 42.96 43.83Q42.96 41.61 41.99 40.49Q41.01 39.36 38.76 39.36Z",
  ],
  [
    "M49.26 38.76Q49.89 38.79 50.91 38.82Q51.93 38.85 52.92 38.85Q54.33 38.85 55.62 38.82Q56.91 38.79 57.45 38.79Q60.6 38.79 62.19 40.11Q63.78 41.43 63.78 43.5Q63.78 44.55 63.35 45.56Q62.91 46.56 61.91 47.39Q60.9 48.21 59.22 48.72L59.22 48.78Q61.59 49.08 62.93 49.91Q64.26 50.73 64.8 51.84Q65.34 52.95 65.34 54.18Q65.34 55.89 64.49 57.2Q63.63 58.5 62.01 59.25Q60.39 60 58.14 60Q57.48 60 56.16 59.96Q54.84 59.91 52.98 59.91Q51.93 59.91 50.91 59.93Q49.89 59.94 49.26 60L49.26 59.4Q50.28 59.34 50.81 59.16Q51.33 58.98 51.51 58.44Q51.69 57.9 51.69 56.82L51.69 41.94Q51.69 40.83 51.51 40.31Q51.33 39.78 50.81 39.59Q50.28 39.39 49.26 39.36Z",
    "M56.7 39.36Q55.32 39.36 54.9 39.87Q54.48 40.38 54.48 41.94L54.48 56.82Q54.48 57.87 54.66 58.41Q54.84 58.95 55.32 59.13Q55.8 59.31 56.73 59.31Q59.67 59.31 61.01 57.95Q62.34 56.58 62.34 54.06Q62.34 51.75 61.1 50.49Q59.85 49.23 57 49.23L53.91 49.23Q53.91 49.23 53.91 48.98Q53.91 48.72 53.91 48.72L56.49 48.72Q58.26 48.72 59.22 48.05Q60.18 47.37 60.54 46.25Q60.9 45.12 60.9 43.83Q60.9 41.61 59.93 40.49Q58.95 39.36 56.7 39.36Z",
  ],
] as const;
