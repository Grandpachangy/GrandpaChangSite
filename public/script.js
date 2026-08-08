const CHANNEL = "grandpachang";
const LIVE_POLL_MS = 60 * 1000;

const parentHost = window.location.hostname || "localhost";

const liveBanner = document.getElementById("live-banner");
const liveTitleEl = document.getElementById("live-title");
const liveViewersEl = document.getElementById("live-viewers");
const livePlayerSection = document.getElementById("live-player-section");
const offlinePanel = document.getElementById("offline-panel");
const livePlayerFrame = document.getElementById("live-player");
const liveChatFrame = document.getElementById("live-chat");

const vodsStatus = document.getElementById("vods-status");
const vodsGrid = document.getElementById("vods-grid");
const vodsPrev = document.getElementById("vods-prev");
const vodsNext = document.getElementById("vods-next");

const playerFrame = document.getElementById("player-frame");
const playerPlaceholder = document.getElementById("player-placeholder");
const popoutToggle = document.getElementById("popout-toggle");
const popoutRestore = document.getElementById("popout-restore");

let isLiveEmbedded = false;
let isPoppedOut = false;

function setPoppedOut(poppedOut) {
  isPoppedOut = poppedOut;
  playerFrame.classList.toggle("is-popped-out", poppedOut);
  playerPlaceholder.classList.toggle("is-hidden", !poppedOut);
  popoutToggle.textContent = poppedOut ? "⤡" : "⤢";
  popoutToggle.title = poppedOut ? "Return player" : "Pop out player";
}

popoutToggle.addEventListener("click", () => setPoppedOut(!isPoppedOut));
popoutRestore.addEventListener("click", () => setPoppedOut(false));

// Fullscreen. itzon's embed exposes no controls of its own (its <video> has
// no `controls` attribute and the only URL param it reads is `preview`), so
// the fullscreen request is driven from here against the frame we own.
const fullscreenToggle = document.getElementById("fullscreen-toggle");

function currentFullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function requestFullscreen(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return Promise.resolve(el.webkitRequestFullscreen());
  return Promise.reject(new Error("Fullscreen not supported"));
}

function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return Promise.resolve(document.webkitExitFullscreen());
}

const canFullscreen = Boolean(playerFrame.requestFullscreen || playerFrame.webkitRequestFullscreen);
if (!canFullscreen) fullscreenToggle.classList.add("is-hidden");

function syncFullscreenButton() {
  const on = Boolean(currentFullscreenEl());
  fullscreenToggle.classList.toggle("is-active", on);
  fullscreenToggle.title = on ? "Exit fullscreen" : "Fullscreen";
  fullscreenToggle.setAttribute("aria-label", fullscreenToggle.title);
}

const playerNote = document.getElementById("player-note");
let playerNoteTimer = null;

function showPlayerNote(msg) {
  if (!playerNote) return;
  playerNote.textContent = msg;
  playerNote.classList.remove("is-hidden");
  clearTimeout(playerNoteTimer);
  playerNoteTimer = setTimeout(() => playerNote.classList.add("is-hidden"), 9000);
}

// Browsers differ on which element they'll accept, so try the frame we own
// first and fall back to the iframe itself before reporting failure.
async function enterFullscreen() {
  const targets = [
    ["player frame", playerFrame],
    ["player iframe", livePlayerFrame],
  ];
  const failures = [];

  for (const [label, el] of targets) {
    if (!el) continue;
    try {
      await requestFullscreen(el);
      return true;
    } catch (err) {
      failures.push(`${label}: ${err.name || "Error"} — ${err.message || "no detail"}`);
    }
  }

  console.error("Fullscreen failed:", failures);
  showPlayerNote("Fullscreen blocked — " + failures.join(" | "));
  return false;
}

function toggleFullscreen() {
  if (currentFullscreenEl()) {
    exitFullscreen();
    return;
  }
  // Fullscreen always goes from the docked frame, never the floating one.
  if (isPoppedOut) setPoppedOut(false);
  enterFullscreen();
}

fullscreenToggle.addEventListener("click", toggleFullscreen);

// Double-click the video to toggle fullscreen, as most video players do.
document.querySelectorAll(".player-dblzone").forEach((zone) => {
  zone.addEventListener("dblclick", toggleFullscreen);
});

document.addEventListener("fullscreenchange", syncFullscreenButton);
document.addEventListener("webkitfullscreenchange", syncFullscreenButton);

// Side stream: the Twitch player in a small floating window, running
// alongside the main itzon.tv player. Muted by default so it doesn't fight
// the main player for audio; viewers can unmute it in the player itself.
const sidestream = document.getElementById("sidestream");
const sidestreamFrame = document.getElementById("sidestream-frame");
const sidestreamToggle = document.getElementById("sidestream-toggle");
const sidestreamClose = document.getElementById("sidestream-close");

let isSidestreamOpen = false;

function setSidestream(open) {
  isSidestreamOpen = open;
  sidestream.classList.toggle("is-hidden", !open);
  sidestreamToggle.classList.toggle("is-active", open);
  // Only hold a connection while it's actually on screen.
  sidestreamFrame.src = open
    ? `https://player.twitch.tv/?channel=${CHANNEL}&parent=${parentHost}&muted=true`
    : "about:blank";
}

sidestreamToggle.addEventListener("click", () => setSidestream(!isSidestreamOpen));
sidestreamClose.addEventListener("click", () => setSidestream(false));

// ?preview forces the live layout without an actual broadcast, so the player
// controls can be exercised while offline. Only active when the param is
// present, so normal visitors are unaffected.
const previewMode = new URLSearchParams(location.search).has("preview");

function showLivePlayer() {
  if (isLiveEmbedded) return;
  livePlayerFrame.src = `https://itzon.tv/embed/${CHANNEL}`;
  livePlayerSection.classList.remove("is-hidden");
  offlinePanel.classList.add("is-hidden");
  isLiveEmbedded = true;
}

async function checkLive() {
  if (previewMode) {
    liveBanner.classList.remove("is-hidden");
    liveTitleEl.textContent = "Preview mode — showing the live layout, not actually live";
    liveViewersEl.textContent = "";
    showLivePlayer();
    return;
  }

  try {
    const res = await fetch("/api/live");
    const data = await res.json();

    if (data.live) {
      liveBanner.classList.remove("is-hidden");
      liveTitleEl.textContent = data.title || "";
      liveViewersEl.textContent = data.viewers ? `${data.viewers.toLocaleString()} watching` : "";

      showLivePlayer();
    } else {
      liveBanner.classList.add("is-hidden");
      livePlayerSection.classList.add("is-hidden");
      offlinePanel.classList.remove("is-hidden");
      if (isLiveEmbedded) {
        livePlayerFrame.src = "about:blank";
        isLiveEmbedded = false;
        setPoppedOut(false);
        setSidestream(false);
      }
    }
  } catch (err) {
    console.error("Live check failed:", err);
  }
}

function formatDuration(iso) {
  const match = iso.match(/(\d+h)?(\d+m)?(\d+s)?/);
  if (!match) return iso;
  const [, h, m] = match;
  if (h && m) return `${h.replace("h", "h ")}${m}`;
  if (h) return h;
  if (m) return m;
  return iso;
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

async function loadVods() {
  try {
    const res = await fetch("/api/vods");
    const data = await res.json();

    if (!data.vods || data.vods.length === 0) {
      vodsGrid.innerHTML = "";
      vodsStatus.textContent = "No VODs found yet.";
      vodsStatus.classList.remove("is-hidden");
      return;
    }

    vodsGrid.innerHTML = data.vods
      .map(
        (vod, i) => `
      <article class="vod-card">
        <div class="vod-card__player" data-video-id="${escapeHtml(vod.id)}">
          <img
            src="${escapeHtml(vod.thumbnailUrl)}"
            alt=""
            loading="${i < 2 ? "eager" : "lazy"}"
            fetchpriority="${i < 2 ? "high" : "auto"}"
          />
          <button type="button" class="vod-card__play" aria-label="Play ${escapeHtml(vod.title)}">▶</button>
        </div>
        <div class="vod-card__body">
          <p class="vod-card__title">${escapeHtml(vod.title)}</p>
          <div class="vod-card__meta">
            <span>${formatDuration(vod.duration)}</span>
            <span>&middot;</span>
            <span>${timeAgo(vod.publishedAt)}</span>
          </div>
        </div>
      </article>
    `
      )
      .join("");

    updateVodsNav();
  } catch (err) {
    vodsGrid.innerHTML = "";
    vodsStatus.textContent = "Couldn't load VODs right now.";
    vodsStatus.classList.remove("is-hidden");
    console.error("VOD load failed:", err);
  }
}

// Escapes quotes as well as angle brackets. The previous textContent/innerHTML
// trick left quotes intact, which let a title containing `"` break out of an
// attribute and inject event handlers.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

vodsGrid.addEventListener("click", (e) => {
  const playerEl = e.target.closest(".vod-card__player");
  if (!playerEl || playerEl.classList.contains("is-loaded")) return;

  const videoId = encodeURIComponent(playerEl.dataset.videoId);
  playerEl.classList.add("is-loaded");
  playerEl.innerHTML = `
    <iframe
      src="https://player.twitch.tv/?video=${videoId}&parent=${parentHost}&autoplay=true"
      allowfullscreen
      scrolling="no"
    ></iframe>
  `;
});

function updateVodsNav() {
  const maxScroll = vodsGrid.scrollWidth - vodsGrid.clientWidth;
  vodsPrev.disabled = vodsGrid.scrollLeft <= 4;
  vodsNext.disabled = vodsGrid.scrollLeft >= maxScroll - 4;
}

function scrollVods(direction) {
  vodsGrid.scrollBy({ left: direction * vodsGrid.clientWidth, behavior: "smooth" });
}

vodsPrev.addEventListener("click", () => scrollVods(-1));
vodsNext.addEventListener("click", () => scrollVods(1));
vodsGrid.addEventListener("scroll", updateVodsNav);
window.addEventListener("resize", updateVodsNav);

// Fall back to the gradient placeholder until an avatar file exists, so a
// missing public/avatar.jpg degrades quietly instead of showing a broken icon.
const aboutAvatar = document.getElementById("about-avatar");
const aboutAvatarImg = document.getElementById("about-avatar-img");
if (aboutAvatarImg) {
  const markMissing = () => aboutAvatar.classList.add("has-no-image");
  aboutAvatarImg.addEventListener("error", markMissing, { once: true });
  if (aboutAvatarImg.complete && aboutAvatarImg.naturalWidth === 0) markMissing();
}

// Now playing, via Last.fm. Hidden entirely unless a track is actually
// playing, so it stays out of the way when there's nothing to show.
const NOWPLAYING_POLL_MS = 10 * 1000;
const nowPlayingEl = document.getElementById("nowplaying");
const npArt = document.getElementById("np-art");
const npTitle = document.getElementById("np-title");
const npArtist = document.getElementById("np-artist");
const npLabel = document.getElementById("np-label");

// Compact relative time for the "last played" label.
function timeAgoShort(unixSeconds) {
  const mins = Math.floor((Date.now() / 1000 - unixSeconds) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
let nowPlayingTimer = null;
let nowPlayingStopped = false;

function startNowPlayingPolling() {
  if (nowPlayingStopped || nowPlayingTimer) return;
  nowPlayingTimer = setInterval(checkNowPlaying, NOWPLAYING_POLL_MS);
}

function stopNowPlayingPolling() {
  clearInterval(nowPlayingTimer);
  nowPlayingTimer = null;
}

async function checkNowPlaying() {
  try {
    const res = await fetch("/api/nowplaying");
    const data = await res.json();

    // Credentials not set yet: stop polling rather than hammering the endpoint.
    if (data.configured === false) {
      nowPlayingEl.classList.add("is-hidden");
      nowPlayingStopped = true;
      stopNowPlayingPolling();
      return;
    }

    // Nothing ever scrobbled: nothing worth showing.
    if (!data.title) {
      nowPlayingEl.classList.add("is-hidden");
      return;
    }

    // textContent throughout: track and artist names are third-party data.
    npTitle.textContent = data.title;
    npArtist.textContent = data.artist || "";
    npLabel.textContent = data.playing
      ? "Now playing"
      : `Last played${data.playedAt ? " · " + timeAgoShort(data.playedAt) : ""}`;
    nowPlayingEl.classList.toggle("is-idle", !data.playing);

    if (data.art) {
      npArt.src = data.art;
      npArt.classList.remove("is-hidden");
    } else {
      npArt.removeAttribute("src");
      npArt.classList.add("is-hidden");
    }

    nowPlayingEl.classList.remove("is-hidden");
  } catch (err) {
    nowPlayingEl.classList.add("is-hidden");
    console.error("Now playing check failed:", err);
  }
}

// League of Legends live-game status. Auto-opens the card the moment a
// tracked account enters a game; the tab always lets it be toggled either
// way afterward. The whole widget stays hidden until RIOT_API_KEY is
// configured, matching the now-playing widget's degrade-quietly pattern.
const LEAGUE_POLL_MS = 10 * 1000;
const leagueWidget = document.getElementById("league-widget");
const leagueToggle = document.getElementById("league-toggle");
const leagueCard = document.getElementById("league-card");
const leagueIcon = document.getElementById("league-icon");
const leagueStatus = document.getElementById("league-status");
const leagueDetail = document.getElementById("league-detail");
const leagueTimerEl = document.getElementById("league-timer");
const leagueMain = document.getElementById("league-main");
const leagueSpells = document.getElementById("league-spells");
const leagueSide = document.getElementById("league-side");
const leagueMatchup = document.getElementById("league-matchup");
const leagueMatchupBody = document.getElementById("league-matchup-body");
const leagueAllyBody = document.getElementById("league-ally-body");
const leagueBans = document.getElementById("league-bans");
const leagueBansBody = document.getElementById("league-bans-body");

let leagueOpen = false;
let leagueLastState = "idle";
let leagueTimer = null;
let leagueStopped = false;

// Game clock. The API reports elapsed seconds at fetch time; this ticks it
// locally between polls so the timer moves every second rather than jumping
// in 10s steps.
let gameClockBaseSec = null;
let gameClockSyncedAt = 0;
let gameClockTicker = null;

function formatClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function renderClock() {
  if (gameClockBaseSec === null) {
    leagueTimerEl.textContent = "";
    return;
  }
  const elapsed = gameClockBaseSec + (Date.now() - gameClockSyncedAt) / 1000;
  leagueTimerEl.textContent = formatClock(elapsed);
}

// Riot refreshes `gameLength` in coarse steps of about a minute, so between
// refreshes it reads progressively behind the real clock -- measured live it
// swung from accurate to ~66s stale and back. Re-syncing to a stale read would
// drag the timer backwards, so a sync is only accepted when it moves forward:
// the display then tracks the accurate value each refresh lands on, and ticks
// locally in between. A large backwards jump is a different game starting, and
// does reset the clock.
const CLOCK_RESET_THRESHOLD_SEC = 90;

function startGameClock(baseSec) {
  const displayed =
    gameClockBaseSec === null
      ? null
      : gameClockBaseSec + (Date.now() - gameClockSyncedAt) / 1000;

  const isStalledSync =
    displayed !== null &&
    baseSec < displayed &&
    displayed - baseSec < CLOCK_RESET_THRESHOLD_SEC;

  if (isStalledSync) {
    // Keep ticking locally rather than rewinding to the stale value.
    if (!gameClockTicker) gameClockTicker = setInterval(renderClock, 1000);
    return;
  }

  gameClockBaseSec = baseSec;
  gameClockSyncedAt = Date.now();
  renderClock();
  if (!gameClockTicker) gameClockTicker = setInterval(renderClock, 1000);
}

function stopGameClock() {
  clearInterval(gameClockTicker);
  gameClockTicker = null;
  gameClockBaseSec = null;
  leagueTimerEl.textContent = "";
}

// Builds an <img> without innerHTML, so Riot-supplied names never touch
// markup parsing.
function championImg(champ, cls) {
  const img = document.createElement("img");
  img.src = champ.icon || "";
  img.alt = champ.name || "";
  img.title = champ.name || "";
  img.loading = "lazy";
  if (cls) img.className = cls;
  return img;
}

// Fills one team row. The player's own pick gets a marker class so it stands
// out from the other four without needing a separate legend.
function renderLineup(target, champs) {
  target.replaceChildren();
  for (const c of champs) {
    target.appendChild(championImg(c, c.isMe ? "league-me" : null));
  }
}

function setLeagueOpen(open) {
  leagueOpen = open;
  leagueCard.classList.toggle("is-collapsed", !open);
  leagueToggle.setAttribute("aria-expanded", String(open));
}

leagueToggle.addEventListener("click", () => setLeagueOpen(!leagueOpen));

function startLeaguePolling() {
  if (leagueStopped || leagueTimer) return;
  leagueTimer = setInterval(checkLeague, LEAGUE_POLL_MS);
}

function stopLeaguePolling() {
  clearInterval(leagueTimer);
  leagueTimer = null;
}

// The account last seen in a game. The server keeps the same hint in module
// scope, but a serverless instance may be recycled at any moment, and when
// that happened the post-game lookup was skipped and a finished match showed
// as idle. The page outlives those instances, so it carries the continuity.
// Stored so it also survives a reload -- refreshing right after a game was
// exactly when the result went missing.
const LEAGUE_HINT_KEY = "league:lastAccount";
const LEAGUE_HINT_WINDOW_MS = 12 * 60 * 1000;

function readLeagueHint() {
  try {
    const raw = localStorage.getItem(LEAGUE_HINT_KEY);
    if (!raw) return null;
    const { account, at } = JSON.parse(raw);
    if (!account || Date.now() - at > LEAGUE_HINT_WINDOW_MS) return null;
    return account;
  } catch (err) {
    // Private browsing can throw on access, and a malformed value is not
    // worth failing the poll over.
    return null;
  }
}

function writeLeagueHint(account) {
  try {
    if (account) {
      localStorage.setItem(LEAGUE_HINT_KEY, JSON.stringify({ account, at: Date.now() }));
    } else {
      localStorage.removeItem(LEAGUE_HINT_KEY);
    }
  } catch (err) {
    /* Nothing to do: the hint is an optimisation, not a requirement. */
  }
}

function leagueEndpoint() {
  const hint = readLeagueHint();
  return hint ? `/api/league?last=${encodeURIComponent(hint)}` : "/api/league";
}

async function checkLeague() {
  try {
    const res = await fetch(leagueEndpoint());
    // A 500 body has no `state`, which used to fall through to the idle
    // branch and knock the card out of its in-game state.
    if (!res.ok) throw new Error(`league endpoint returned ${res.status}`);
    const data = await res.json();

    // Credentials not set yet: stop polling rather than hammering the endpoint.
    if (data.configured === false) {
      leagueStopped = true;
      stopLeaguePolling();
      return;
    }

    // The sweep couldn't determine anything (rate limit, upstream blip).
    // Hold whatever is on screen instead of falsely showing "not in game".
    if (data.state === "unknown") return;

    leagueWidget.classList.remove("is-hidden");

    const state = data.state || "idle";
    leagueCard.classList.toggle("is-in-game", state === "in-game");
    leagueCard.classList.toggle("is-win", state === "post-game" && data.win === true);
    leagueCard.classList.toggle("is-loss", state === "post-game" && data.win === false);

    // Refresh the hint while a game runs, so it stays valid for the
    // post-game lookup once the match ends.
    if (state === "in-game" && data.account) writeLeagueHint(data.account);
    // Once idle, the result has already been shown or the window has passed;
    // dropping it stops needless match-history lookups on later polls.
    if (state === "idle") writeLeagueHint(null);

    if (state === "in-game") {
      renderInGame(data);
    } else if (state === "post-game") {
      renderPostGame(data);
    } else {
      renderIdle();
    }

    // Auto-open on entering a game and again when the result lands, since
    // both are moments worth surfacing. Manual toggles within a state are
    // left alone.
    if (state !== leagueLastState && (state === "in-game" || state === "post-game")) {
      setLeagueOpen(true);
    }
    leagueLastState = state;
  } catch (err) {
    console.error("League check failed:", err);
  }
}

function renderInGame(data) {
  // textContent throughout: every value here is third-party data.
  leagueStatus.textContent = `Playing ${data.champion ? data.champion.name : "a champion"}`;
  leagueDetail.textContent = [data.account, data.queue].filter(Boolean).join(" · ");

  leagueSide.textContent = data.side ? `${data.side} side` : "";
  leagueSide.className =
    "league-side" + (data.side ? ` league-side--${data.side.toLowerCase()}` : "");

  if (data.champion && data.champion.icon) {
    leagueIcon.src = data.champion.icon;
    leagueIcon.alt = data.champion.name || "";
    leagueIcon.classList.remove("is-hidden");
  } else {
    leagueIcon.removeAttribute("src");
    leagueIcon.classList.add("is-hidden");
  }

  leagueSpells.replaceChildren();
  for (const spell of data.spells || []) {
    const img = document.createElement("img");
    img.src = spell.icon;
    img.alt = spell.name;
    img.title = spell.name;
    img.loading = "lazy";
    leagueSpells.appendChild(img);
  }

  leagueMain.classList.remove("is-hidden");

  // Both full line-ups, rather than a guessed lane pairing. The player's own
  // champion is marked so they can find themselves in their team's row.
  const allies = data.allyTeam || [];
  const enemies = data.enemyTeam || [];
  renderLineup(leagueAllyBody, allies);
  renderLineup(leagueMatchupBody, enemies);
  leagueMatchup.classList.toggle("is-hidden", !allies.length && !enemies.length);

  leagueBansBody.replaceChildren();
  if ((data.bans || []).length) {
    leagueBansBody.className = "league-iconrow league-bansrow";
    for (const c of data.bans) leagueBansBody.appendChild(championImg(c));
    leagueBans.classList.remove("is-hidden");
  } else {
    leagueBans.classList.add("is-hidden");
  }

  // gameLength is the source that matches the clock on the player's screen.
  // Riot refreshes it in coarse ~60s steps, so a given read is anywhere from
  // current to a minute behind; `fetchedAt` covers the time it then spent in
  // the edge cache, and startGameClock's forward-only rule does the rest --
  // stale reads are ignored while the local tick keeps running, so the display
  // settles on the accurate value each refresh lands on.
  //
  // gameStartTime is deliberately not preferred: it precedes the in-game clock
  // reaching 0:00 by roughly a minute, so counting from it runs ahead.
  if (typeof data.gameLengthSec === "number") {
    const cacheAgeSec =
      typeof data.fetchedAt === "number"
        ? Math.max(0, (Date.now() - data.fetchedAt) / 1000)
        : 0;
    startGameClock(data.gameLengthSec + cacheAgeSec);
  } else if (typeof data.gameStartedAt === "number" && data.gameStartedAt > 0) {
    startGameClock((Date.now() - data.gameStartedAt) / 1000);
  } else {
    stopGameClock();
  }
}

function renderPostGame(data) {
  stopGameClock();

  leagueStatus.textContent = data.win ? "Victory" : "Defeat";
  leagueTimerEl.textContent =
    typeof data.durationSec === "number" ? formatClock(data.durationSec) : "";

  const kda = `${data.kills}/${data.deaths}/${data.assists}`;
  leagueDetail.textContent = `${data.champion ? data.champion.name : ""} · ${kda}`.trim();
  leagueSide.className = "league-side";
  leagueSide.textContent = [
    data.queue,
    typeof data.cs === "number" ? `${data.cs} CS` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (data.champion && data.champion.icon) {
    leagueIcon.src = data.champion.icon;
    leagueIcon.alt = data.champion.name || "";
    leagueIcon.classList.remove("is-hidden");
  } else {
    leagueIcon.removeAttribute("src");
    leagueIcon.classList.add("is-hidden");
  }

  leagueSpells.replaceChildren();
  leagueAllyBody.replaceChildren();
  leagueMatchupBody.replaceChildren();
  leagueMain.classList.remove("is-hidden");
  leagueMatchup.classList.add("is-hidden");
  leagueBans.classList.add("is-hidden");
}

function renderIdle() {
  stopGameClock();
  leagueStatus.textContent = "Not currently in game";
  leagueDetail.textContent = "";
  leagueSide.textContent = "";
  leagueSide.className = "league-side";
  leagueIcon.removeAttribute("src");
  leagueSpells.replaceChildren();
  leagueAllyBody.replaceChildren();
  leagueMatchupBody.replaceChildren();
  leagueMain.classList.add("is-hidden");
  leagueMatchup.classList.add("is-hidden");
  leagueBans.classList.add("is-hidden");
}

// ---------------------------------------------------------------------------
// Motion: scroll reveal, backdrop parallax, scroll progress, click rings.
// All of it is decorative, so every piece degrades to "no movement" rather
// than to "no content" -- and the whole block is skipped for visitors who
// have asked for reduced motion.
// ---------------------------------------------------------------------------
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Reveal on scroll. Runs even under reduced motion so the headings' underline
// state still lands; the CSS simply removes the movement.
const revealTargets = document.querySelectorAll("[data-reveal]");
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        // One-shot: sections don't re-hide when scrolled back past.
        revealObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
  );
  revealTargets.forEach((el) => revealObserver.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add("is-visible"));
}

// Scroll-driven work, batched into one rAF pass so several listeners can't
// each force their own layout read on the same frame.
const parallaxLayers = Array.from(document.querySelectorAll("[data-parallax]")).map(
  (el) => ({ el, factor: parseFloat(el.dataset.parallax) || 0 })
);
const scrollProgress = document.getElementById("scroll-progress");
const siteHeader = document.getElementById("site-header");

// Keeps distant layers from wandering far off screen on a long page.
const PARALLAX_LIMIT_PX = 180;
let scrollTicking = false;

function onScrollFrame() {
  scrollTicking = false;
  const y = window.scrollY || window.pageYOffset || 0;

  if (scrollProgress) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    scrollProgress.style.transform = `scaleX(${ratio})`;
  }

  if (siteHeader) siteHeader.classList.toggle("is-stuck", y > 8);

  if (!reducedMotion.matches) {
    for (const { el, factor } of parallaxLayers) {
      const offset = Math.max(
        -PARALLAX_LIMIT_PX,
        Math.min(PARALLAX_LIMIT_PX, -y * factor)
      );
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    }
  }
}

function requestScrollFrame() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(onScrollFrame);
}

window.addEventListener("scroll", requestScrollFrame, { passive: true });
window.addEventListener("resize", requestScrollFrame, { passive: true });
onScrollFrame();

// Drop the parallax offsets if the preference is turned on mid-session,
// otherwise the layers would freeze wherever they happened to be.
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    for (const { el } of parallaxLayers) el.style.transform = "";
  }
  requestScrollFrame();
});

// Click ring. Drawn in a fixed overlay rather than inside the clicked
// element, so it works over any control without touching its layout.
const fxLayer = document.getElementById("fx");
const MAX_RINGS = 6;

document.addEventListener(
  "pointerdown",
  (e) => {
    if (!fxLayer || reducedMotion.matches) return;
    // Primary button / touch only, and never for synthesised events.
    if (e.button !== 0 || !e.isTrusted) return;
    while (fxLayer.childElementCount >= MAX_RINGS) {
      fxLayer.removeChild(fxLayer.firstElementChild);
    }
    const ring = document.createElement("span");
    ring.className = "fx__ring";
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
    fxLayer.appendChild(ring);
  },
  { passive: true }
);

let isChatLoaded = false;
function loadChat() {
  if (isChatLoaded) return;
  isChatLoaded = true;
  liveChatFrame.src = `https://www.twitch.tv/embed/${CHANNEL}/chat?parent=${parentHost}&darkpopout`;
}

if (document.readyState === "complete") {
  loadChat();
} else {
  window.addEventListener("load", loadChat, { once: true });
}

checkLive();
loadVods();
checkNowPlaying();
checkLeague();
setInterval(checkLive, LIVE_POLL_MS);
startNowPlayingPolling();
startLeaguePolling();

// Only poll while the tab is actually being looked at, and refresh the moment
// it comes back so the card is current rather than up to one interval stale.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopNowPlayingPolling();
    stopLeaguePolling();
  } else {
    checkNowPlaying();
    checkLeague();
    startNowPlayingPolling();
    startLeaguePolling();
  }
});
