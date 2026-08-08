const CHANNEL = "grandpachang";
const LIVE_POLL_MS = 60 * 1000;

const parentHost = window.location.hostname || "localhost";

// ---------------------------------------------------------------------------
// Performance tier
//
// With hardware acceleration off, everything the compositor normally does for
// free lands on the CPU: backdrop-filter, large animated blurs and the 3D
// branch context go from cheap to crippling. There is no API that reports
// whether acceleration is on, so rather than guess at the cause this measures
// the symptom -- actual frame pacing -- which also catches weak CPUs and
// battery saver. Falling behind switches the page to `perf-lite`, which drops
// the expensive effects and keeps the movement.
// ---------------------------------------------------------------------------
const PERF_KEY = "perf:lite";
const PERF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// ~42fps. Comfortably below 60Hz without tripping on a 120Hz display, where a
// genuinely smooth frame is 8ms and an occasional 16ms one is still fine.
const SLOW_FRAME_MS = 24;

const perfOverride = new URLSearchParams(location.search).get("lite");

function setPerfLite(on) {
  document.documentElement.classList.toggle("perf-lite", on);
}

function storePerfLite(on) {
  try {
    localStorage.setItem(PERF_KEY, JSON.stringify({ lite: on, at: Date.now() }));
  } catch (err) {
    /* Storage is an optimisation here, not a requirement. */
  }
}

// A stored verdict is applied before the first paint of the heavy layers, so a
// returning visitor isn't made to sit through the measurement window again.
(function applyStoredPerfTier() {
  if (perfOverride === "1") return setPerfLite(true);
  if (perfOverride === "0") {
    storePerfLite(false);
    return;
  }
  try {
    const raw = localStorage.getItem(PERF_KEY);
    if (!raw) return;
    const { lite, at } = JSON.parse(raw);
    // Re-measure occasionally: a machine's circumstances change.
    if (Date.now() - at < PERF_TTL_MS) setPerfLite(Boolean(lite));
  } catch (err) {
    /* Ignore a malformed value and just measure again. */
  }
})();

// Direct signal. When acceleration is switched off, Chromium either refuses a
// WebGL context outright or hands back its software rasteriser, and the name
// says so. Read locally to pick a rendering tier and never sent anywhere.
//
// Returns true for "software", false for "a real GPU", and null when the
// browser withholds the detail -- Firefox and Safari mask it -- in which case
// the frame-pacing measurement below is the only thing to go on.
function detectSoftwareRendering() {
  let gl = null;
  try {
    const canvas = document.createElement("canvas");
    gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    // No context at all is the usual shape of acceleration being disabled.
    if (!gl) return true;

    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "")
      : "";
    if (!renderer) return null;
    return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(
      renderer
    );
  } catch (err) {
    return null;
  } finally {
    // Contexts are a limited resource; this one existed only for its name.
    if (gl) {
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }
  }
}

function measureFramePacing() {
  if (perfOverride !== null) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // A software rasteriser is conclusive on its own, and cheaper to establish
  // than a second of sampling.
  if (detectSoftwareRendering() === true) {
    setPerfLite(true);
    storePerfLite(true);
    console.info("Reduced effects: software rendering detected. Add ?lite=0 to force them back on.");
    return;
  }

  const deltas = [];
  let last = performance.now();
  // Skip the first frames: load, font swap and iframe attach all land there.
  let warmup = 12;

  function frame(now) {
    const dt = now - last;
    last = now;

    // A backgrounded tab throttles rAF to a crawl; that is not the page being
    // slow, so the sample is abandoned rather than counted.
    if (document.hidden) return;

    if (warmup > 0) {
      warmup--;
    } else {
      deltas.push(dt);
      if (deltas.length >= 70) {
        deltas.sort((a, b) => a - b);
        const median = deltas[Math.floor(deltas.length / 2)];
        const lite = median > SLOW_FRAME_MS;
        setPerfLite(lite);
        storePerfLite(lite);
        if (lite) {
          console.info(
            `Reduced effects: median frame ${median.toFixed(1)}ms. Add ?lite=0 to force them back on.`
          );
        }
        return;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Measure once the page has settled, so start-up work isn't mistaken for jank.
if (document.readyState === "complete") {
  setTimeout(measureFramePacing, 900);
} else {
  window.addEventListener("load", () => setTimeout(measureFramePacing, 900), { once: true });
}

// Keeping the live state in the tab title means a pinned or background tab
// shows it without being switched to.
const BASE_TITLE = document.title;
function setTitleLive(isLive) {
  const wanted = isLive ? `\u{1F534} LIVE \u00B7 ${BASE_TITLE}` : BASE_TITLE;
  if (document.title !== wanted) document.title = wanted;
}

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
    setTitleLive(true);
    showLivePlayer();
    return;
  }

  try {
    const res = await fetch("/api/live");
    const data = await res.json();

    setTitleLive(Boolean(data.live));

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
// null until a poll reports something, so the first result after a page load
// isn't mistaken for a state change and used to force the card open.
let leagueLastState = null;
let leagueTimer = null;
let leagueStopped = false;

// Game clock. The API reports elapsed seconds at fetch time; this ticks it
// locally between polls so the timer moves every second rather than jumping
// in 10s steps.
let gameClockBaseSec = null;
let gameClockGameId = null;
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
// drag the timer backwards, so a sync is only accepted when it moves forward,
// and the display ticks locally in between.
//
// A new match is identified by gameId, never by how far a value jumped back.
// Edge nodes cache independently, so a poll can legitimately return a snapshot
// a minute or more older than the last one -- treating a big backwards jump as
// a new game reset the timer to that stale value mid-match.

// Riot's gameLength runs a constant ~30s behind the clock on the player's
// screen, even immediately after it refreshes. Measured against a live game:
// the in-game clock read 15:10 while a freshly refreshed gameLength gave
// 14:40. (gameStartTime sits 60s the other side of it, which is why counting
// from that ran 30s ahead.) Applied at the point of display so the API keeps
// reporting Riot's raw value.
const CLOCK_OFFSET_SEC = 30;

function startGameClock(baseSec, gameId) {
  // A different match: take the new value as-is, however far it moves.
  if (gameId != null && gameId !== gameClockGameId) {
    gameClockGameId = gameId;
    gameClockBaseSec = baseSec;
    gameClockSyncedAt = Date.now();
    renderClock();
    if (!gameClockTicker) gameClockTicker = setInterval(renderClock, 1000);
    return;
  }

  const displayed =
    gameClockBaseSec === null
      ? null
      : gameClockBaseSec + (Date.now() - gameClockSyncedAt) / 1000;

  const isStaleSync = displayed !== null && baseSec < displayed;

  if (isStaleSync) {
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
  gameClockGameId = null;
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

const LEAGUE_OPEN_KEY = "league:cardOpen";

function setLeagueOpen(open, remember) {
  leagueOpen = open;
  leagueCard.classList.toggle("is-collapsed", !open);
  leagueToggle.setAttribute("aria-expanded", String(open));
  // Only a deliberate toggle updates the preference; auto-opening on a new
  // game must not overwrite what the visitor chose.
  if (remember) {
    try {
      localStorage.setItem(LEAGUE_OPEN_KEY, open ? "1" : "0");
    } catch (err) {
      /* Preference is a nicety; storage being unavailable is not an error. */
    }
  }
}

// Restore the visitor's last choice, so a refresh mid-game doesn't reopen a
// card they had deliberately collapsed.
try {
  if (localStorage.getItem(LEAGUE_OPEN_KEY) === "1") setLeagueOpen(true);
} catch (err) {
  /* Ignore: falls back to the collapsed default. */
}

leagueToggle.addEventListener("click", () => setLeagueOpen(!leagueOpen, true));

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
// How long a finished game's result stays on screen, measured from first sight.
const POSTGAME_DISPLAY_MS = 5 * 60 * 1000;
let postGameSeenKey = null;
let postGameSeenAt = 0;

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

    // The Accounts panel flags whichever account is playing. That is already
    // known here, so it costs nothing rather than a sweep of its own.
    const nextLiveKey = state === "in-game" ? data.account || null : null;
    if (nextLiveKey !== liveAccountKey) {
      liveAccountKey = nextLiveKey;
      if (accountsData) renderAccounts();
    }
    // Deliberately NOT cleared on a plain idle. Match-V5 does not publish a
    // match the instant it ends, so the first polls after a game legitimately
    // come back idle -- dropping the hint there meant we stopped looking right
    // before the result became available, which is why finished games never
    // appeared. It is cleared once a result has actually been shown, and
    // otherwise expires on its own after LEAGUE_HINT_WINDOW_MS.
    if (state === "idle" && leagueLastState === "post-game") writeLeagueHint(null);

    // How long a result stays on screen is timed from when this page first
    // saw it, not from when the match ended. Match-V5 publishes some minutes
    // late, and timing it from the end meant that lag silently shortened the
    // window -- or consumed it before the result ever became available.
    let effectiveState = state;
    if (state === "post-game") {
      const key = data.endedAt || data.durationSec || "current";
      if (postGameSeenKey !== key) {
        postGameSeenKey = key;
        postGameSeenAt = Date.now();
      }
      if (Date.now() - postGameSeenAt > POSTGAME_DISPLAY_MS) {
        effectiveState = "idle";
        writeLeagueHint(null);
      }
    } else if (state === "in-game") {
      postGameSeenKey = null;
    }

    if (effectiveState === "in-game") {
      renderInGame(data);
    } else if (effectiveState === "post-game") {
      renderPostGame(data);
    } else {
      renderIdle();
    }

    // Auto-open on entering a game and again when the result lands, since
    // both are moments worth surfacing. Manual toggles within a state are
    // left alone.
    // Auto-open only on a transition this page actually witnessed. On the
    // first poll after a load leagueLastState is null, so an already-running
    // game no longer forces the card open over a deliberate collapse.
    if (
      leagueLastState !== null &&
      effectiveState !== leagueLastState &&
      (effectiveState === "in-game" || effectiveState === "post-game")
    ) {
      setLeagueOpen(true);
    }
    leagueLastState = effectiveState;
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

  // Two ways to place the clock, and they fail in opposite ways.
  //
  // gameLength matches the clock on the player's screen, but Riot refreshes it
  // in coarse ~60s steps, so any single read is between current and a minute
  // behind. Across repeated polls that is harmless: the forward-only rule
  // ignores stale reads while the local tick keeps running, so the display
  // settles onto the accurate value each refresh lands on.
  //
  // gameStartTime is continuous rather than stepped, so it is never stale, but
  // it sits on the far side of the real clock -- preceding 0:00 by about the
  // same minute -- and how long that is depends on how long the match took to
  // load, which varies per game.
  //
  // So: gameStartTime for the very first anchor, gameLength for everything
  // after. A fresh page has no running display to protect it, so a stale
  // gameLength would be shown as-is -- that was the ~1 minute dip after a
  // refresh, which then jumped up once a current read arrived. Steady state
  // stays on gameLength, where the per-game loading variance can't reach it.
  const cacheAgeSec =
    typeof data.fetchedAt === "number"
      ? Math.max(0, (Date.now() - data.fetchedAt) / 1000)
      : 0;
  const fromLength =
    typeof data.gameLengthSec === "number"
      ? data.gameLengthSec + cacheAgeSec + CLOCK_OFFSET_SEC
      : null;
  const fromStart =
    typeof data.gameStartedAt === "number" && data.gameStartedAt > 0
      ? (Date.now() - data.gameStartedAt) / 1000 - CLOCK_OFFSET_SEC
      : null;

  const isFirstAnchor = gameClockBaseSec === null;
  const base = isFirstAnchor
    ? fromStart ?? fromLength
    : fromLength ?? fromStart;

  if (base === null) {
    stopGameClock();
  } else {
    startGameClock(base, data.gameId);
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

// ---------------------------------------------------------------------------
// Header dropdowns. `hidden` is the single source of truth for open state, so
// a closed panel is out of the tab order and the accessibility tree entirely.
// ---------------------------------------------------------------------------
const menus = Array.from(document.querySelectorAll("[data-menu]")).map((root) => ({
  root,
  button: root.querySelector(".menu__button"),
  panel: root.querySelector(".menu__panel"),
}));

function setMenuOpen(menu, open) {
  menu.panel.hidden = !open;
  menu.button.setAttribute("aria-expanded", String(open));
}

function closeAllMenus(except) {
  for (const m of menus) if (m !== except) setMenuOpen(m, false);
}

for (const menu of menus) {
  menu.button.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.panel.hidden;
    closeAllMenus(menu);
    setMenuOpen(menu, willOpen);
  });

  // Choosing an item closes the menu; external links open in a new tab, so
  // leaving it hanging open would be the only thing left on screen.
  menu.panel.addEventListener("click", (e) => {
    if (e.target.closest(".menu__item")) setMenuOpen(menu, false);
  });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-menu]")) closeAllMenus();
});

// ---------------------------------------------------------------------------
// Accounts panel
// ---------------------------------------------------------------------------
const accountsModal = document.getElementById("accounts-modal");
const accountsOpen = document.getElementById("accounts-open");
const accountsBody = document.getElementById("accounts-body");
const accountsStatus = document.getElementById("accounts-status");

let accountsLoaded = false;
let accountsData = null;
// Which account the League widget currently reports in a game, so the panel
// can flag it without a second sweep of its own.
let liveAccountKey = null;
let lastFocusedBeforeModal = null;

function tierLabel(q) {
  if (!q || !q.tier) return null;
  const tier = q.tier.charAt(0) + q.tier.slice(1).toLowerCase();
  // Apex tiers have a single division, so the numeral is noise.
  const apex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(q.tier);
  return apex || !q.division ? tier : `${tier} ${q.division}`;
}

function renderAccounts() {
  if (!accountsData) return;
  accountsBody.replaceChildren();

  for (const acc of accountsData.accounts || []) {
    const row = document.createElement("article");
    row.className = "account";
    if (acc.key === liveAccountKey) row.classList.add("is-live");

    const id = document.createElement("div");
    id.className = "account__id";

    // textContent throughout: these are Riot-supplied names.
    const name = document.createElement("span");
    name.className = "account__name";
    name.textContent = acc.name;
    const tag = document.createElement("span");
    tag.className = "account__tag";
    tag.textContent = `#${acc.tag}`;
    name.appendChild(tag);
    id.appendChild(name);

    const region = document.createElement("span");
    region.className = "account__region";
    region.textContent = acc.region;
    id.appendChild(region);

    if (acc.key === liveAccountKey) {
      const live = document.createElement("span");
      live.className = "account__live";
      live.textContent = "In game";
      id.appendChild(live);
    }
    row.appendChild(id);

    const rank = document.createElement("div");
    rank.className = "account__rank";
    const label = tierLabel(acc.solo);
    const tier = document.createElement("span");
    tier.className = "account__tier";
    if (acc.unavailable) {
      tier.textContent = "Unavailable";
    } else if (label) {
      tier.textContent = label;
      tier.dataset.tier = acc.solo.tier;
    } else {
      tier.textContent = "Unranked";
    }
    rank.appendChild(tier);

    if (label) {
      const lp = document.createElement("span");
      lp.className = "account__lp";
      lp.textContent = `${acc.solo.lp} LP`;
      rank.appendChild(lp);
    }
    row.appendChild(rank);

    const bits = [];
    if (acc.solo && acc.solo.winRate !== null) {
      bits.push(`${acc.solo.wins}W ${acc.solo.losses}L · ${acc.solo.winRate}%`);
    }
    const flexLabel = tierLabel(acc.flex);
    if (flexLabel) bits.push(`Flex: ${flexLabel}`);
    if (bits.length) {
      const record = document.createElement("div");
      record.className = "account__record";
      record.textContent = bits.join("  ·  ");
      row.appendChild(record);
    }

    accountsBody.appendChild(row);
  }
}

async function loadAccounts() {
  if (accountsLoaded) return;
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) throw new Error(`accounts endpoint returned ${res.status}`);
    const data = await res.json();

    if (data.configured === false || !(data.accounts || []).length) {
      accountsBody.replaceChildren();
      accountsStatus.textContent = "Account data isn't available right now.";
      accountsStatus.classList.remove("is-hidden");
      return;
    }

    accountsData = data;
    accountsLoaded = true;
    accountsStatus.classList.add("is-hidden");
    renderAccounts();
  } catch (err) {
    console.error("Accounts load failed:", err);
    accountsBody.replaceChildren();
    accountsStatus.textContent = "Couldn't load accounts right now.";
    accountsStatus.classList.remove("is-hidden");
  }
}

function setAccountsOpen(open) {
  accountsModal.hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";

  if (open) {
    lastFocusedBeforeModal = document.activeElement;
    loadAccounts();
    accountsModal.querySelector(".modal__close").focus();
  } else if (lastFocusedBeforeModal) {
    // Return focus where it came from, so keyboard users aren't dumped at the
    // top of the document.
    lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  }
}

accountsOpen.addEventListener("click", () => setAccountsOpen(true));
accountsModal.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) setAccountsOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!accountsModal.hidden) {
    setAccountsOpen(false);
    return;
  }
  if (menus.some((m) => !m.panel.hidden)) {
    const open = menus.find((m) => !m.panel.hidden);
    closeAllMenus();
    open.button.focus();
  }
});

// Keeps tabbing inside the dialog while it is open.
accountsModal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusable = accountsModal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

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
