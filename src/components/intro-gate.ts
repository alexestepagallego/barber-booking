/** sessionStorage key, set when the intro starts playing in this tab. */
export const INTRO_SEEN_KEY = "bb-intro-seen";

/**
 * Runs in <head>, before the first paint, and marks <html data-intro="skip">
 * when the intro curtain must not show: the staff panel and manage links
 * (people there want to act, not watch), or a second page load in the same
 * tab. Reduced motion is handled in CSS. It has to be an inline script:
 * by the time React hydrates, the curtain would already be on screen. The
 * static CSP allows inline scripts (ADR 0006).
 */
export const INTRO_GATE_SCRIPT = `(function () {
  var root = document.documentElement;
  if (/^\\/(admin|manage)(\\/|$)/.test(location.pathname)) root.setAttribute("data-intro", "skip");
  try {
    if (sessionStorage.getItem("${INTRO_SEEN_KEY}")) root.setAttribute("data-intro", "skip");
  } catch (e) {}
})();`;
