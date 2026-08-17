// Ranked standing for every tracked account, for the Accounts panel.
//
// League-V4 moved to PUUID-keyed lookups, but the older summoner-id route is
// still what some regions answer on. Riot returns 404/403 for a route it does
// not recognise, which is indistinguishable from "no data" -- so this tries
// the PUUID route first and falls back to the summoner route rather than
// silently reporting everyone as unranked.

const {
  ACCOUNTS,
  accountKey,
  regionLabel,
  riotFetch,
  getPuuid,
} = require("./_riot");

const SOLO = "RANKED_SOLO_5x5";
const FLEX = "RANKED_FLEX_SR";

// Ranks move slowly and this sweeps every account, so a good answer is cached
// hard -- the binding constraint is the personal key's request budget, not
// freshness. A sweep that failed is a different thing entirely and must not
// inherit that: caching "Unavailable" for ten minutes turned a momentary Riot
// hiccup into ten minutes of a panel that looked broken, on every visitor.
const CACHE_MS = 10 * 60 * 1000;
const FAILED_CACHE_MS = 45 * 1000;
let cache = null;
let cachedAt = 0;
let cacheTtl = CACHE_MS;
// Kept beside the cache rather than inside it, so ?diag=1 can be answered from
// a cached sweep too. Storing it in the payload meant diagnostics depended on
// which request happened to fill the cache: an ordinary request cached a
// payload with no diag and the next ?diag=1 got nothing back, while a diag
// request cached one that carried the failure map to every visitor after it.
let lastFailures = {};

// How many accounts are in flight at once.
//
// Not all of them: firing the whole list at one platform host is what let a
// single rate-limit window fail every account together. Not one at a time
// either -- that was the first fix here, and it multiplied worst-case wall
// time by the length of the list, which on a cold instance with the fallback
// path in play is enough serial round trips to risk the function's own time
// limit. Three keeps the burst far inside Riot's per-region allowance while
// bounding the sweep to a few rounds.
const SWEEP_CONCURRENCY = 3;

// Ordered, bounded parallelism. Results land at their original index so the
// payload keeps the configured account order regardless of who finishes first.
async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

// Last rank each account reported successfully, so a failed refresh can show a
// slightly old number instead of nothing. Per instance and lost on recycle,
// which is fine -- it is a cushion for a blip, not a store of record.
const lastGood = new Map();

async function getEntries(account, puuid, apiKey) {
  const host = `https://${account.platform}.api.riotgames.com`;

  const byPuuid = await riotFetch(
    `${host}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
    apiKey
  );
  if (byPuuid.ok) return byPuuid.json();
  // 404 here means "no ranked entries" on a route that exists; only fall back
  // when the route itself was rejected.
  if (byPuuid.status === 404) return [];

  // Falling back on a rate limit or an outage is actively harmful: the route
  // is fine, we are simply being told to slow down, and the fallback spends
  // two more calls per account to be told the same thing. That turns one 429
  // into a burst of them, which is how a brief limit became a whole sweep of
  // "Unavailable". Only a rejected route is worth a second route.
  if (byPuuid.status !== 400 && byPuuid.status !== 403) {
    const err = new Error(`League entries by-puuid failed: ${byPuuid.status}`);
    err.status = byPuuid.status;
    throw err;
  }

  const summonerRes = await riotFetch(
    `${host}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
    apiKey
  );
  if (!summonerRes.ok) {
    const err = new Error(`Summoner lookup failed: ${summonerRes.status}`);
    err.status = summonerRes.status;
    throw err;
  }
  const summoner = await summonerRes.json();
  if (!summoner.id) return [];

  const bySummoner = await riotFetch(
    `${host}/lol/league/v4/entries/by-summoner/${encodeURIComponent(summoner.id)}`,
    apiKey
  );
  if (bySummoner.status === 404) return [];
  if (!bySummoner.ok) {
    const err = new Error(`League entries failed: ${bySummoner.status}`);
    err.status = bySummoner.status;
    throw err;
  }
  return bySummoner.json();
}

function queuePayload(entry) {
  if (!entry) return null;
  const wins = entry.wins ?? 0;
  const losses = entry.losses ?? 0;
  const games = wins + losses;
  return {
    tier: entry.tier || null,
    division: entry.rank || null,
    lp: entry.leaguePoints ?? 0,
    wins,
    losses,
    // Rounded server-side so every client renders the same number.
    winRate: games ? Math.round((wins / games) * 100) : null,
  };
}

module.exports = async (req, res) => {
  const apiKey = process.env.RIOT_API_KEY;

  if (!apiKey) {
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(200).json({ configured: false, accounts: [] });
    return;
  }

  // Diagnostics are attached per request, never stored, so asking for them is
  // what decides whether they appear.
  const wantsDiag = Boolean(req.query && req.query.diag);
  const send = (payload, failures) =>
    res
      .status(200)
      .json(wantsDiag ? { ...payload, diag: { failures } } : payload);

  const now = Date.now();
  if (cache && now - cachedAt < cacheTtl) {
    res.setHeader("Cache-Control", `s-maxage=${Math.round(cacheTtl / 1000)}`);
    send(cache, lastFailures);
    return;
  }

  try {
    const failures = {};

    const accounts = await mapWithLimit(ACCOUNTS, SWEEP_CONCURRENCY, async (account) => {
      const base = {
        name: account.gameName,
        tag: account.tagLine,
        key: accountKey(account),
        region: regionLabel(account),
      };
      try {
        const puuid = await getPuuid(account, apiKey);
        const entries = await getEntries(account, puuid, apiKey);
        const list = Array.isArray(entries) ? entries : [];
        const ranks = {
          solo: queuePayload(list.find((e) => e.queueType === SOLO)),
          flex: queuePayload(list.find((e) => e.queueType === FLEX)),
        };
        lastGood.set(base.key, ranks);
        return { ...base, ...ranks };
      } catch (err) {
        // One account failing must not blank the whole panel.
        console.error(`accounts: ${base.key} failed:`, err.message);
        failures[base.key] = err.status ? String(err.status) : err.message;

        // Show what this account last reported rather than "Unavailable".
        // A rank that is a few minutes old is a far better answer than none,
        // and `stale` says plainly which it is.
        const known = lastGood.get(base.key);
        return known
          ? { ...base, ...known, stale: true }
          : { ...base, solo: null, flex: null, unavailable: true };
      }
    });

    const degraded = Object.keys(failures).length > 0;

    const payload = { configured: true, accounts };
    if (degraded) payload.degraded = true;

    cache = payload;
    cachedAt = now;
    lastFailures = failures;
    // A degraded sweep is worth retrying in under a minute; a clean one is not.
    cacheTtl = degraded ? FAILED_CACHE_MS : CACHE_MS;

    res.setHeader(
      "Cache-Control",
      degraded
        ? `s-maxage=${FAILED_CACHE_MS / 1000}`
        : "s-maxage=600, stale-while-revalidate=1800"
    );
    send(payload, failures);
  } catch (err) {
    console.error("accounts endpoint failed:", err);
    res.status(500).json({ error: "Unable to fetch accounts" });
  }
};
