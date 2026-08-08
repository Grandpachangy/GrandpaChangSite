// Reports League status for a set of accounts, in three states:
//   in game      -- champion, timer, spells, matchup, side, bans
//   post-game    -- result + KDA, for 5 minutes after a match ends
//   idle         -- nothing playing
//
// APIs involved:
//   Account-V1   (regional cluster) -- Riot ID -> PUUID, cached indefinitely
//   Spectator-V5 (platform routing) -- PUUID -> active game, 404 when not in one
//   Match-V5     (regional cluster) -- last finished match, for the post-game card
// Champion/spell names and icons come from Data Dragon, which is static and
// needs no key.

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

// EUW and EUNE both route through the europe cluster for Account-V1/Match-V5.
const ACCOUNT_CLUSTER = "europe";

// How long after a match ends to keep showing the result.
const POSTGAME_WINDOW_MS = 5 * 60 * 1000;
// How long to keep checking match history after last seeing someone in a game.
const POSTGAME_LOOKUP_WINDOW_MS = 12 * 60 * 1000;

const QUEUE_NAMES = {
  400: "Normal Draft",
  420: "Ranked Solo/Duo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  480: "Swiftplay",
  490: "Quickplay",
  700: "Clash",
  720: "ARAM Clash",
  900: "ARURF",
  1010: "Snow ARURF",
  1020: "One for All",
  1300: "Nexus Blitz",
  1400: "Ultimate Spellbook",
  1700: "Arena",
  1710: "Arena",
  1900: "URF",
  2300: "Brawl",
  // Riot's internal gameMode for this one is "KIWI", which is what a live game
  // displayed before it was mapped. Ids verified against Riot's queues.json.
  2400: "ARAM: Mayhem",
};

// Riot's gameMode for an unmapped queue is an internal codename in caps
// (a live game came back as "KIWI"). Title-casing at least stops it being
// shouted at viewers; the queueId travels in the payload so an unknown mode
// can be identified and added above rather than guessed at.
function queueLabel(game) {
  const known = QUEUE_NAMES[game.gameQueueConfigId];
  if (known) return known;
  const mode = typeof game.gameMode === "string" ? game.gameMode : "";
  if (!mode || mode === "CLASSIC") return "Custom";
  return mode.charAt(0) + mode.slice(1).toLowerCase();
}

const puuidCache = new Map();

// Which account was last found in a game, and when. Checked first on the next
// sweep: while a game runs that turns an 8-call sweep into a 1-call hit, which
// matters because the personal-key budget (~50 req/min) is the binding
// constraint. The timestamp also scopes post-game lookups so match history
// isn't queried when nobody has played recently.
let lastActiveKey = null;
let lastActiveSeenAt = 0;

// Post-game results are re-read at most this often, rather than every sweep.
let postGameCache = null;
let postGameCacheKey = null;
let postGameCachedAt = 0;
const POSTGAME_CACHE_MS = 45 * 1000;

let staticCache = null;
let staticCachedAt = 0;
const STATIC_TTL_MS = 24 * 60 * 60 * 1000;

async function riotFetch(url, apiKey) {
  return fetch(url, { headers: { "X-Riot-Token": apiKey } });
}

// Resolves a client-supplied account hint to a known account, or null. The
// string is compared against the configured list and never used to build a
// request, so an arbitrary value can only ever fail to match.
function accountFromHint(hint) {
  if (typeof hint !== "string" || !hint || hint.length > 64) return null;
  return ACCOUNTS.find((a) => `${a.gameName}#${a.tagLine}` === hint) || null;
}

function accountsByPriority() {
  if (!lastActiveKey) return ACCOUNTS;
  const idx = ACCOUNTS.findIndex(
    (a) => `${a.gameName}#${a.tagLine}` === lastActiveKey
  );
  if (idx <= 0) return ACCOUNTS;
  return [ACCOUNTS[idx], ...ACCOUNTS.slice(0, idx), ...ACCOUNTS.slice(idx + 1)];
}

// Champion and summoner-spell lookup tables, keyed by the numeric ids the
// game APIs return.
async function getStaticIndex() {
  const now = Date.now();
  if (staticCache && now - staticCachedAt < STATIC_TTL_MS) return staticCache;

  const versionsRes = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
  if (!versionsRes.ok) throw new Error("Data Dragon versions fetch failed");
  const version = (await versionsRes.json())[0];

  const [champRes, spellRes] = await Promise.all([
    fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`),
    fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/summoner.json`),
  ]);
  if (!champRes.ok) throw new Error("Data Dragon champion fetch failed");
  if (!spellRes.ok) throw new Error("Data Dragon summoner fetch failed");

  const champJson = await champRes.json();
  const spellJson = await spellRes.json();

  const championsById = new Map();
  for (const slug of Object.keys(champJson.data || {})) {
    const c = champJson.data[slug];
    championsById.set(String(c.key), { name: c.name, slug: c.id });
  }

  const spellsById = new Map();
  for (const slug of Object.keys(spellJson.data || {})) {
    const s = spellJson.data[slug];
    spellsById.set(String(s.key), { name: s.name, slug: s.id });
  }

  staticCache = { version, championsById, spellsById };
  staticCachedAt = now;
  return staticCache;
}

function championPayload(idx, championId) {
  const champ = idx.championsById.get(String(championId));
  return {
    name: champ ? champ.name : `Champion ${championId}`,
    icon: champ
      ? `https://ddragon.leagueoflegends.com/cdn/${idx.version}/img/champion/${champ.slug}.png`
      : null,
  };
}

function spellPayload(idx, spellId) {
  const spell = idx.spellsById.get(String(spellId));
  if (!spell) return null;
  return {
    name: spell.name,
    icon: `https://ddragon.leagueoflegends.com/cdn/${idx.version}/img/spell/${spell.slug}.png`,
  };
}

async function getPuuid(account, apiKey) {
  const key = `${account.gameName}#${account.tagLine}`;
  if (puuidCache.has(key)) return puuidCache.get(key);

  const url =
    `https://${ACCOUNT_CLUSTER}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(account.gameName)}/${encodeURIComponent(account.tagLine)}`;

  const res = await riotFetch(url, apiKey);
  if (!res.ok) {
    const err = new Error(`Account lookup failed for ${key}: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  puuidCache.set(key, data.puuid);
  return data.puuid;
}

async function getActiveGame(account, apiKey) {
  const puuid = await getPuuid(account, apiKey);
  // Spectator-V5 kept the `by-summoner` path segment from v4 even though it
  // now takes a PUUID. `by-puuid` is not a real route -- and Riot answers
  // unknown routes with 403, which is indistinguishable from a permissions
  // failure, so getting this wrong is silently misleading.
  const url =
    `https://${account.platform}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/` +
    encodeURIComponent(puuid);

  const res = await riotFetch(url, apiKey);
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Spectator failed for ${account.platform}: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const game = await res.json();
  const me = (game.participants || []).find((p) => p.puuid === puuid);
  return { game, me, puuid };
}

// Most recent finished match, if it ended inside the post-game window.
async function getPostGame(account, apiKey) {
  const now = Date.now();
  const cacheKey = `${account.gameName}#${account.tagLine}`;
  // Keyed by account: with the hint in play a request can now ask about a
  // different account than the one that filled the cache.
  if (
    postGameCache &&
    postGameCacheKey === cacheKey &&
    now - postGameCachedAt < POSTGAME_CACHE_MS
  ) {
    return postGameCache;
  }

  const puuid = await getPuuid(account, apiKey);
  const idsUrl =
    `https://${ACCOUNT_CLUSTER}.api.riotgames.com/lol/match/v5/matches/by-puuid/` +
    `${encodeURIComponent(puuid)}/ids?start=0&count=1`;

  const idsRes = await riotFetch(idsUrl, apiKey);
  if (!idsRes.ok) return null;
  const ids = await idsRes.json();
  if (!Array.isArray(ids) || !ids.length) return null;

  const matchRes = await riotFetch(
    `https://${ACCOUNT_CLUSTER}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(ids[0])}`,
    apiKey
  );
  if (!matchRes.ok) return null;

  const match = await matchRes.json();
  const info = match.info || {};
  const endedAt = info.gameEndTimestamp || 0;
  if (!endedAt || now - endedAt > POSTGAME_WINDOW_MS) {
    postGameCache = null;
    postGameCacheKey = cacheKey;
    postGameCachedAt = now;
    return null;
  }

  const me = (info.participants || []).find((p) => p.puuid === puuid);
  if (!me) return null;

  const idx = await getStaticIndex();
  const result = {
    account: `${account.gameName}#${account.tagLine}`,
    champion: championPayload(idx, me.championId),
    win: Boolean(me.win),
    kills: me.kills ?? 0,
    deaths: me.deaths ?? 0,
    assists: me.assists ?? 0,
    cs: (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0),
    queue: queueLabel({ gameQueueConfigId: info.queueId, gameMode: info.gameMode }),
    durationSec: info.gameDuration ?? null,
    endedAt,
  };

  postGameCache = result;
  postGameCacheKey = cacheKey;
  postGameCachedAt = now;
  return result;
}

module.exports = async (req, res) => {
  const apiKey = process.env.RIOT_API_KEY;

  if (!apiKey) {
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(200).json({ configured: false, state: "idle" });
    return;
  }

  try {
    let checkedOk = 0;
    let failures = 0;
    let activeAccountFailed = false;
    let authFailures = 0;

    for (const account of accountsByPriority()) {
      let result = null;
      try {
        result = await getActiveGame(account, apiKey);
        checkedOk++;
      } catch (err) {
        if (err.status === 401 || err.status === 403) authFailures++;
        failures++;
        // A failure on the account that was last seen playing is the one that
        // matters: the others returning "not in a game" says nothing about it.
        if (`${account.gameName}#${account.tagLine}` === lastActiveKey) {
          activeAccountFailed = true;
        }
        console.error("league: account check failed:", err.message);
        continue;
      }
      if (!result || !result.me) continue;

      const { game, me } = result;
      const idx = await getStaticIndex();
      lastActiveKey = `${account.gameName}#${account.tagLine}`;
      lastActiveSeenAt = Date.now();
      // A new game invalidates any cached post-game result.
      postGameCache = null;

      // Both full line-ups. Spectator-V5 carries no lane or role field, so
      // any per-lane pairing would be inference dressed up as fact -- the
      // sites that do show positions build them from their own match-history
      // models, not from this endpoint. Showing all ten picks is simply true.
      const myTeam = me.teamId;
      const participants = game.participants || [];
      const allies = participants.filter((p) => p.teamId === myTeam);
      const enemies = participants.filter((p) => p.teamId !== myTeam);

      const lineup = (list) =>
        list.map((p) => ({
          ...championPayload(idx, p.championId),
          isMe: p.puuid === me.puuid,
        }));

      res.setHeader("Cache-Control", "s-maxage=15");
      res.status(200).json({
        configured: true,
        keyValid: true,
        state: "in-game",
        account: `${account.gameName}#${account.tagLine}`,
        region: account.platform === "eun1" ? "EUNE" : "EUW",
        champion: championPayload(idx, me.championId),
        queue: queueLabel(game),
        queueId: game.gameQueueConfigId ?? null,
        // gameLength is what matches the clock on the player's screen: it
        // crosses zero exactly when the in-game clock starts, running negative
        // during the loading screen. gameStartTime is roughly a minute earlier
        // than that, so counting from it runs ahead; it stays only as a
        // fallback. Riot refreshes gameLength in coarse steps (~60s), which the
        // client smooths over by ticking locally between syncs.
        //
        // fetchedAt is when we actually read Riot, so the client can add the
        // time since -- including any seconds the response spent in the edge
        // cache, which would otherwise make the timer read low.
        gameLengthSec: typeof game.gameLength === "number" ? game.gameLength : null,
        fetchedAt: Date.now(),
        gameStartedAt:
          typeof game.gameStartTime === "number" && game.gameStartTime > 0
            ? game.gameStartTime
            : null,
        side: myTeam === 100 ? "Blue" : "Red",
        spells: [spellPayload(idx, me.spell1Id), spellPayload(idx, me.spell2Id)].filter(Boolean),
        allyTeam: lineup(allies),
        enemyTeam: lineup(enemies),
        bans: (game.bannedChampions || [])
          .filter((b) => b.championId > 0)
          .map((b) => championPayload(idx, b.championId)),
      });
      return;
    }

    if (checkedOk === 0 && authFailures === ACCOUNTS.length) {
      console.error("league: all accounts failed auth -- RIOT_API_KEY is set but invalid");
      res.setHeader("Cache-Control", "s-maxage=20");
      res.status(200).json({ configured: true, keyValid: false, state: "idle" });
      return;
    }

    // A sweep that told us nothing must not be reported as "not in a game".
    // Returning idle here is indistinguishable from genuinely being idle, so a
    // single rate-limited or timed-out sweep made the widget drop out of the
    // in-game state and then snap back -- the flicker. "unknown" lets the
    // client hold whatever it is already showing.
    const staleActive =
      activeAccountFailed && Date.now() - lastActiveSeenAt < POSTGAME_LOOKUP_WINDOW_MS;
    if ((checkedOk === 0 && failures > 0) || staleActive) {
      console.error(
        `league: sweep inconclusive (ok=${checkedOk} failures=${failures} activeFailed=${activeAccountFailed})`
      );
      // Short cache: retry soon rather than pinning an inconclusive answer.
      res.setHeader("Cache-Control", "s-maxage=5");
      res.status(200).json({ configured: true, keyValid: true, state: "unknown" });
      return;
    }

    // Nobody in a game. If someone was playing recently, check whether their
    // match just finished so the post-game card can take over.
    //
    // Which account that was is remembered in module scope, which a serverless
    // instance is free to discard between requests -- so on a cold start the
    // lookup was skipped and a finished game silently reported as idle. The
    // page therefore passes back the account it last saw in a game, giving the
    // continuity the server can't keep. The hint only ever selects an entry
    // from ACCOUNTS, so it can never reach a Riot URL, and how long a result
    // stays visible is still decided by the match's own end timestamp rather
    // than by anything the client claims.
    const serverRemembers =
      lastActiveKey && Date.now() - lastActiveSeenAt < POSTGAME_LOOKUP_WINDOW_MS;
    const account = serverRemembers
      ? ACCOUNTS.find((a) => `${a.gameName}#${a.tagLine}` === lastActiveKey)
      : accountFromHint(req.query && req.query.last);

    if (account) {
      try {
        const post = await getPostGame(account, apiKey);
        if (post) {
          res.setHeader("Cache-Control", "s-maxage=15");
          res.status(200).json({
            configured: true,
            keyValid: true,
            state: "post-game",
            account: `${account.gameName}#${account.tagLine}`,
            ...post,
          });
          return;
        }
      } catch (err) {
        console.error("league: post-game lookup failed:", err.message);
      }
    }

    // Past the window with nothing playing: drop the hint so later sweeps
    // don't keep favouring a stale account or re-querying match history.
    if (lastActiveKey && Date.now() - lastActiveSeenAt >= POSTGAME_LOOKUP_WINDOW_MS) {
      lastActiveKey = null;
    }

    res.setHeader("Cache-Control", "s-maxage=15");
    res.status(200).json({
      configured: true,
      keyValid: true,
      state: "idle",
      checkedAccounts: checkedOk,
    });
  } catch (err) {
    console.error("league endpoint failed:", err);
    res.status(500).json({ error: "Unable to fetch League status" });
  }
};
