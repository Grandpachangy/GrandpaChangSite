// Serves third-party images from this domain, so a visitor's browser never
// contacts Twitch, Riot or Last.fm to draw the page. See _img.js for why.

const { isAllowed } = require("./_img");

// Thumbnails and champion icons are tens of kilobytes. This is a ceiling on
// something going wrong upstream, not a real limit on anything we ask for.
const MAX_BYTES = 5 * 1024 * 1024;

module.exports = async (req, res) => {
  const url = isAllowed(req.query && req.query.u);
  if (!url) {
    // Deliberately identical for a missing, malformed and disallowed URL: this
    // should not be usable to probe what the allowlist contains.
    res.status(400).json({ error: "Bad request" });
    return;
  }

  try {
    const upstream = await fetch(url.toString());
    if (!upstream.ok) {
      res.status(502).json({ error: "Upstream image unavailable" });
      return;
    }

    // Only images come back out, whatever the upstream decided to send. Without
    // this the endpoint would relay arbitrary content from those hosts under
    // this domain's origin.
    const type = upstream.headers.get("content-type") || "";
    if (!type.startsWith("image/")) {
      res.status(415).json({ error: "Not an image" });
      return;
    }

    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      res.status(413).json({ error: "Image too large" });
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > MAX_BYTES) {
      res.status(413).json({ error: "Image too large" });
      return;
    }

    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(body.length));
    // These never change once published -- a VOD thumbnail and a champion icon
    // are both immutable for the URL that names them -- so this is cached hard
    // at the edge and the function runs about once per image.
    res.setHeader(
      "Cache-Control",
      "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000"
    );
    // Nothing here should be interpreted as anything but an image.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(body);
  } catch (err) {
    console.error("img proxy failed:", err.message);
    res.status(502).json({ error: "Upstream image unavailable" });
  }
};
