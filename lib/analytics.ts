// Google Analytics on the public website only, and only after the visitor accepts
// analytics cookies. Never on candidate interview links (they carry secret tokens),
// the recruiter app, admin, or sign-in pages.

export const GA_ID = "G-85EEW34HLJ";
/** First-party cookie that remembers the visitor's choice (strictly necessary). */
export const CONSENT_COOKIE = "pmh_consent";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 180; // ask again after 6 months
/** Analytics cookies last at most 13 months. */
export const GA_COOKIE_EXPIRES = 60 * 60 * 24 * 395;
/** The live site; anywhere else (local, previews) analytics stays off. */
export const GA_HOSTS = ["pickmyhire.ai", "www.pickmyhire.ai"];
/** Opens the cookie banner again (from a "Cookie settings" link). */
export const COOKIE_SETTINGS_EVENT = "pmh:cookie-settings";

export type Consent = "granted" | "denied";

/** Public pages where analytics may run. */
export function isTrackedPath(pathname: string) {
  return pathname === "/" || pathname === "/demo" || /^\/apply\/[^/]+\/?$/.test(pathname);
}

/** Pages where the cookie banner is shown. */
export function isBannerPath(pathname: string) {
  return isTrackedPath(pathname) || pathname === "/cookies";
}

const KEEP_PARAMS = /^utm_(source|medium|campaign|term|content)$/;

/** Only campaign (utm_*) parameters may be sent; any other parameter could be private. */
export function hasOnlySafeParams(url: URL) {
  return [...url.searchParams.keys()].every((k) => KEEP_PARAMS.test(k));
}

/** The address as sent to analytics: origin, path and campaign parameters only. */
export function cleanLocation(url: URL) {
  const keep = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (KEEP_PARAMS.test(k)) keep.append(k, v);
  const q = keep.toString();
  return `${url.origin}${url.pathname}${q ? `?${q}` : ""}`;
}

/** Where the visitor came from: other sites by origin and path; our own pages by origin only. */
export function cleanReferrer(referrer: string, origin: string) {
  if (!referrer) return "";
  try {
    const r = new URL(referrer);
    return r.origin === origin ? r.origin : `${r.origin}${r.pathname}`;
  } catch {
    return "";
  }
}

/** Analytics may run on this address: a tracked public page with nothing private in it. */
export function isTrackableUrl(url: URL) {
  return isTrackedPath(url.pathname) && hasOnlySafeParams(url);
}
