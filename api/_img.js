// Rewrites third-party image URLs to go through api/img.js.
//
// The consent gate covers the iframes, but images are a request to a third
// party too: twelve VOD thumbnails on the home page each handed Twitch the
// visitor's IP before anything had been agreed to, which made the gate on the
// embeds beside them close to pointless.
//
// Gating the pictures as well would have left the page looking broken for
// anyone who declined. Serving them from this domain instead means no third
// party is contacted at all, so there is nothing to ask about and everyone
// sees the same page. It also puts the thumbnails behind our own cache headers.

// Exactly the hosts the site's own endpoints hand out, so this cannot be
// pointed at anything else. Anything not on the list is dropped rather than
// proxied or passed through -- a missing image is a small loss; an open image
// proxy on someone else's domain is not.
const ALLOWED_HOSTS = new Set([
  "static-cdn.jtvnw.net",
  "ddragon.leagueoflegends.com",
  "lastfm-img.freetls.fastly.net",
  "lastfm.freetls.fastly.net",
]);

function isAllowed(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch (err) {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;
  return url;
}

// Returns a same-origin path, or null when the URL is not one we serve. Callers
// pass the null through as "no image" rather than falling back to the original,
// which would put the leak straight back.
function proxiedImage(raw) {
  const url = isAllowed(raw);
  return url ? `/api/img?u=${encodeURIComponent(url.toString())}` : null;
}

module.exports = { ALLOWED_HOSTS, isAllowed, proxiedImage };
