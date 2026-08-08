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

// Ranks move slowly and this sweeps every account, so it is cached hard --
// the binding constraint is the personal key's request budget, not freshness.
const CACHE_MS = 10 * 60 * 1000;
let cache = null;
let cachedAt = 0;

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

  const now = Date.now();
  if (cache && now - cachedAt < CACHE_MS) {
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    res.status(200).json(cache);
    return;
  }

  try {
    const accounts = await Promise.all(
      ACCOUNTS.map(async (account) => {
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
          return {
            ...base,
            solo: queuePayload(list.find((e) => e.queueType === SOLO)),
            flex: queuePayload(list.find((e) => e.queueType === FLEX)),
          };
        } catch (err) {
          // One account failing must not blank the whole panel.
          console.error(`accounts: ${base.key} failed:`, err.message);
          return { ...base, solo: null, flex: null, unavailable: true };
        }
      })
    );

    const payload = { configured: true, accounts };
    cache = payload;
    cachedAt = now;

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    res.status(200).json(payload);
  } catch (err) {
    console.error("accounts endpoint failed:", err);
    res.status(500).json({ error: "Unable to fetch accounts" });
  }
};
