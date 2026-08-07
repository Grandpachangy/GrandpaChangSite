// Reports whether any of the configured League accounts is currently in a
// game, and which champion is being played.
//
// Two Riot APIs are involved:
//   Account-V1   (regional cluster) -- Riot ID -> PUUID, cached indefinitely
//   Spectator-V5 (platform routing) -- PUUID -> active game, 404 when not in one
// Champion id -> name/icon comes from Data Dragon, which is static and needs
// no key.

const ACCOUNTS = [
  { gameName: "Vita Nihil", tagLine: "Empty", platform: "eun1" },
  { gameName: "mors venit", tagLine: "mox", platform: "euw1" },
  { gameName: "rojzz", tagLine: "euw", platform: "euw1" },
  { gameName: "therookie", tagLine: "reubs", platform: "euw1" },
  { gameName: "likethewind", tagLine: "woosh", platform: "euw1" },
  { gameName: "exoispatrick", tagLine: "bottl", platform: "euw1" },
  { gameName: "vita nihil", tagLine: "blank", platform: "euw1" },
  { gameName: "ere", tagLine: "mrm", platform: "euw1" },
];

// EUW and EUNE both resolve Riot IDs through the europe cluster.
const ACCOUNT_CLUSTER = "europe";

const QUEUE_NAMES = {
  400: "Normal Draft",
  420: "Ranked Solo/Duo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  490: "Quickplay",
  700: "Clash",
  1700: "Arena",
  1900: "URF",
};

// PUUIDs are stable, so resolve each Riot ID once per warm instance.
const puuidCache = new Map();
let championsCache = null;
let championsCachedAt = 0;
const CHAMPIONS_TTL_MS = 24 * 60 * 60 * 1000;

async function riotFetch(url, apiKey) {
  return fetch(url, { headers: { "X-Riot-Token": apiKey } });
}

async function getChampionIndex() {
  const now = Date.now();
  if (championsCache && now - championsCachedAt < CHAMPIONS_TTL_MS) {
    return championsCache;
  }

  const versionsRes = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
  if (!versionsRes.ok) throw new Error("Data Dragon versions fetch failed");
  const versions = await versionsRes.json();
  const version = versions[0];

  const champRes = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`
  );
  if (!champRes.ok) throw new Error("Data Dragon champion fetch failed");
  const champJson = await champRes.json();

  // Data Dragon keys by champion name; we need numeric id -> { name, slug }.
  const byId = new Map();
  for (const slug of Object.keys(champJson.data || {})) {
    const c = champJson.data[slug];
    byId.set(String(c.key), { name: c.name, slug: c.id });
  }

  championsCache = { version, byId };
  championsCachedAt = now;
  return championsCache;
}

async function getPuuid(account, apiKey) {
  const key = `${account.gameName}#${account.tagLine}`;
  if (puuidCache.has(key)) return puuidCache.get(key);

  const url =
    `https://${ACCOUNT_CLUSTER}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(account.gameName)}/${encodeURIComponent(account.tagLine)}`;

  const res = await riotFetch(url, apiKey);
  if (!res.ok) {
    // Don't cache failures -- a bad key or transient error shouldn't stick.
    throw new Error(`Account lookup failed for ${key}: ${res.status}`);
  }

  const data = await res.json();
  puuidCache.set(key, data.puuid);
  return data.puuid;
}

async function getActiveGame(account, apiKey) {
  const puuid = await getPuuid(account, apiKey);
  const url =
    `https://${account.platform}.api.riotgames.com/lol/spectator/v5/active-games/by-puuid/` +
    encodeURIComponent(puuid);

  const res = await riotFetch(url, apiKey);

  // 404 is the normal "not currently in a game" answer.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Spectator failed for ${account.platform}: ${res.status}`);

  const game = await res.json();
  const me = (game.participants || []).find((p) => p.puuid === puuid);
  return { game, me };
}

module.exports = async (req, res) => {
  const apiKey = process.env.RIOT_API_KEY;

  if (!apiKey) {
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(200).json({ configured: false, inGame: false });
    return;
  }

  try {
    // Stop at the first account found in a game -- normally at most one is,
    // so this usually costs far fewer calls than checking all of them.
    for (const account of ACCOUNTS) {
      let result = null;
      try {
        result = await getActiveGame(account, apiKey);
      } catch (err) {
        // One bad account shouldn't take down the whole widget.
        console.error("league: account check failed:", err.message);
        continue;
      }
      if (!result || !result.me) continue;

      const { game, me } = result;
      const champions = await getChampionIndex();
      const champ = champions.byId.get(String(me.championId));

      res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=20");
      res.status(200).json({
        configured: true,
        inGame: true,
        account: `${account.gameName}#${account.tagLine}`,
        region: account.platform === "eun1" ? "EUNE" : "EUW",
        champion: champ ? champ.name : `Champion ${me.championId}`,
        championIcon: champ
          ? `https://ddragon.leagueoflegends.com/cdn/${champions.version}/img/champion/${champ.slug}.png`
          : null,
        queue: QUEUE_NAMES[game.gameQueueConfigId] || game.gameMode || "Custom",
        gameLengthSec: typeof game.gameLength === "number" ? game.gameLength : null,
      });
      return;
    }

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=20");
    res.status(200).json({ configured: true, inGame: false });
  } catch (err) {
    console.error("league endpoint failed:", err);
    res.status(500).json({ error: "Unable to fetch League status" });
  }
};
