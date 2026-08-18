// Playback state reported by Web Scrobbler's webhook.
//
// Last.fm cannot express a pause: a scrobbler announces a track and there is no
// API to retract that, so a paused track keeps reading as "now playing" until
// Last.fm expires the entry -- measured at 2m41s for a three-and-a-half minute
// song, and 4h43m for a long mix. Web Scrobbler knows the moment playback
// stops, and since v3.2.0 it will post that to a URL. api/scrobbler-hook.js is
// that URL; this is where what it says gets kept.
//
// Stored in Upstash over its REST API rather than through a client library,
// because this repo has no runtime dependencies and one fetch is not worth
// changing that.

const STATE_KEY = "playstate";

// Long, because these events are edge-triggered. Web Scrobbler posts once when
// playback pauses and says nothing further until something changes, so a short
// expiry would quietly drop the pause and let the card revert to Last.fm's
// stale entry -- reintroducing the exact bug this exists to fix. The state is
// authoritative until the next event replaces it.
//
// Expiring at all is still worth it: a browser that is closed and never
// reopened should eventually stop speaking for the site.
const STATE_TTL_SEC = 12 * 60 * 60;

// Vercel's KV integration injects the first pair; a plain Upstash database
// injects the second. Accepting both means the setup does not have to guess
// which one was clicked.
function kvUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
}

function kvToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;
}

function kvConfigured() {
  return Boolean(kvUrl() && kvToken());
}

async function kvCommand(command) {
  const res = await fetch(kvUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`KV ${command[0]} failed: ${res.status}`);
  }
  return res.json();
}

// Returns null for "nothing to say", which every caller must treat as "carry on
// with Last.fm". Not configured, expired, unreachable and malformed all land
// here deliberately: this signal is an improvement on the fallback, never a
// requirement for it.
async function readPlayState() {
  if (!kvConfigured()) return null;
  try {
    const { result } = await kvCommand(["GET", STATE_KEY]);
    if (!result) return null;
    const parsed = JSON.parse(result);
    return parsed && typeof parsed.state === "string" ? parsed : null;
  } catch (err) {
    console.error("playstate: read failed:", err.message);
    return null;
  }
}

async function writePlayState(state) {
  await kvCommand(["SET", STATE_KEY, JSON.stringify(state), "EX", STATE_TTL_SEC]);
}

module.exports = {
  STATE_TTL_SEC,
  kvConfigured,
  readPlayState,
  writePlayState,
};
