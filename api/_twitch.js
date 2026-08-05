const CHANNEL_LOGIN = "grandpachang";

let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedUserId = null;

async function getAppAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET env vars");
  }

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`Twitch token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function twitchFetch(path) {
  const token = await getAppAccessToken();
  const clientId = process.env.TWITCH_CLIENT_ID;

  const res = await fetch(`https://api.twitch.tv/helix${path}`, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Twitch API request failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function getBroadcasterId() {
  if (cachedUserId) return cachedUserId;
  const data = await twitchFetch(`/users?login=${CHANNEL_LOGIN}`);
  const user = data.data[0];
  if (!user) throw new Error(`Twitch user "${CHANNEL_LOGIN}" not found`);
  cachedUserId = user.id;
  return cachedUserId;
}

module.exports = { CHANNEL_LOGIN, twitchFetch, getBroadcasterId };
