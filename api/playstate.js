// Write endpoint for the play/pause signal. Posted to by the userscript in
// tools/, never by the site itself.

const { kvConfigured, writePlayState, STATE_TTL_SEC } = require("./_playstate");

// Trimmed hard before anything is stored. These are only ever read back for
// comparison in ?diag=1, but a value that is written once and read forever is
// exactly the kind of thing that grows teeth later.
const MAX_FIELD = 300;

function clean(value) {
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
}

module.exports = async (req, res) => {
  const secret = process.env.PLAYSTATE_TOKEN;

  // Open to any origin on purpose. The secret is the security boundary here,
  // not the origin: this accepts no cookies and no session, so a request
  // without the token is worthless whoever sends it. Being origin-locked
  // instead would buy nothing and would break the moment the browser posts
  // from a page other than the one guessed at.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-playstate-token");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // No secret, no endpoint. Deliberately not "accept anything when unset":
  // an open write endpoint would let anyone on the internet decide whether the
  // site says music is playing.
  if (!secret || secret.length < 16) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!kvConfigured()) {
    res.status(503).json({ error: "Play state storage is not configured" });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch (err) {
    res.status(400).json({ error: "Bad request" });
    return;
  }

  // Header or body. The body form lets the sender use a text/plain POST, which
  // the browser treats as a simple request and sends without a preflight --
  // one fewer round trip for an extension or a blocker to interfere with.
  const offered = req.headers["x-playstate-token"] || body.token;
  if (typeof offered !== "string" || offered !== secret) {
    // No detail: a wrong token and a malformed one should look identical.
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // Only these two. "playing" is recorded but currently acts on nothing --
    // see the note in nowplaying.js about why the signal is allowed to switch
    // the card off and never on.
    const state = body.state === "playing" ? "playing" : "paused";

    await writePlayState({
      state,
      at: Date.now(),
      // Kept purely so the raw player title can be compared against the one
      // Last.fm reports before anything is rendered from it.
      title: clean(body.title),
      artist: clean(body.artist),
      source: clean(body.source) || "userscript",
    });

    res.status(200).json({ ok: true, state, ttl: STATE_TTL_SEC });
  } catch (err) {
    console.error("playstate: write failed:", err.message);
    res.status(500).json({ error: "Unable to store play state" });
  }
};
