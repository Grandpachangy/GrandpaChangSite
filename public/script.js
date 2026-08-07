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
setInterval(checkLive, LIVE_POLL_MS);
startNowPlayingPolling();

// Only poll while the tab is actually being looked at, and refresh the moment
// it comes back so the card is current rather than up to one interval stale.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopNowPlayingPolling();
  } else {
    checkNowPlaying();
    startNowPlayingPolling();
  }
});
