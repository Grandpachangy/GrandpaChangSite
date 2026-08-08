// Shared Riot plumbing. The account list lives here rather than in each
// endpoint so the two can't drift apart, and the PUUID cache is shared for
// free within any instance that happens to serve both.

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

const puuidCache = new Map();

function accountKey(account) {
  return `${account.gameName}#${account.tagLine}`;
}

function regionLabel(account) {
  return account.platform === "eun1" ? "EUNE" : "EUW";
}

async function riotFetch(url, apiKey) {
  return fetch(url, { headers: { "X-Riot-Token": apiKey } });
}

async function getPuuid(account, apiKey) {
  const key = accountKey(account);
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

module.exports = {
  ACCOUNTS,
  ACCOUNT_CLUSTER,
  puuidCache,
  accountKey,
  regionLabel,
  riotFetch,
  getPuuid,
};
