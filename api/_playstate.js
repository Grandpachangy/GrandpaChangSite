// Play/pause reported by the browser that is actually playing the music.
//
// Last.fm cannot answer this. A scrobbler announces a track when it starts and
// there is no API to retract that, so a paused track keeps reading as playing
// until Last.fm expires the entry on its own -- measured at 2m41s for a
// three-and-a-half minute song, and hours for a long mix. The only place that
// knows a pause happened is the tab it happened in, so that is where the signal
// comes from: a userscript posts it here.
//
// Stored in Upstash/Vercel KV over its REST API rather than through a client
// library, because this repo has no runtime dependencies and one fetch is not
// worth changing that.

const STATE_KEY = "playstate";

// Long enough to outlive a missed heartbeat, short enough that a browser which
// simply vanished stops being believed. The script beats every 15s.
const STATE_TTL_SEC = 90;

// Vercel's KV integration injects the first pair; a plain Upstash database
// injects the second. Accepting both means the setup instructions do not have
// to guess which one someone clicked.
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
