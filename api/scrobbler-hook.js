// Receives Web Scrobbler's webhook events.
//
// Configured in the extension as:
//   https://grandpachang.com/api/scrobbler-hook?key=<SCROBBLER_HOOK_KEY>
//
// The events that matter are `paused` and `resumedplaying`, which is the pause
// signal Last.fm has no way to express. `nowplaying` counts as playing too, and
// `scrobble` is deliberately ignored -- Last.fm records a track partway through
// while it is still running, so it says nothing about whether playback stopped.
//
// Web Scrobbler treats any non-200 as a scrobbling error, so an event that is
// simply not interesting still answers 200. Only a bad key is refused, and that
// can never be the extension: the key is in the URL it was given.

const { kvConfigured, writePlayState } = require("./_playstate");

const PLAYING_EVENTS = new Set(["nowplaying", "resumedplaying"]);
const PAUSED_EVENTS = new Set(["paused"]);

const MAX_FIELD = 300;

function clean(value) {
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
}

// Web Scrobbler nests the track under data.song, with `processed` holding the
// cleaned-up values and `parsed` the raw ones scraped from the page. Kept only
// so the two can be compared against what Last.fm reports; nothing is rendered
// from them.
function songFields(body) {
  const song = (body && body.data && body.data.song) || {};
  const processed = song.processed || {};
  const parsed = song.parsed || {};
  return {
    title: clean(processed.track || parsed.track),
    artist: clean(processed.artist || parsed.artist),
  };
}

module.exports = async (req, res) => {
  const secret = process.env.SCROBBLER_HOOK_KEY;

  // No secret, no endpoint. Never "accept anything when unset": an open write
  // endpoint would let anyone decide whether the site says music is playing.
  if (!secret || secret.length < 16) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const offered = req.query && req.query.key;
  if (typeof offered !== "string" || offered !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!kvConfigured()) {
    console.error("scrobbler-hook: KV is not configured");
    // Still 200: the extension cannot fix this and should not start reporting
    // scrobbling errors because of it.
    res.status(200).json({ ok: false, reason: "storage not configured" });
    return;
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (err) {
    res.status(200).json({ ok: false, reason: "unparseable body" });
    return;
  }

  const eventName = typeof body.eventName === "string" ? body.eventName : "";
  const isPlaying = PLAYING_EVENTS.has(eventName);
  const isPaused = PAUSED_EVENTS.has(eventName);

  // Everything else -- scrobble, loved, anything added later -- is fine and
  // simply not a state change.
  if (!isPlaying && !isPaused) {
    res.status(200).json({ ok: true, ignored: eventName || "unknown" });
    return;
  }

  try {
    const { title, artist } = songFields(body);
    await writePlayState({
      state: isPaused ? "paused" : "playing",
      at: Date.now(),
      event: eventName,
      title,
      artist,
    });
    res.status(200).json({ ok: true, state: isPaused ? "paused" : "playing" });
  } catch (err) {
    console.error("scrobbler-hook: write failed:", err.message);
    // 200 again, for the same reason: a storage blip is not the extension's
    // problem to report.
    res.status(200).json({ ok: false, reason: "write failed" });
  }
};
