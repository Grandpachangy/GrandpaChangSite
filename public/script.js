const CHANNEL = "grandpachang";
const LIVE_POLL_MS = 60 * 1000;

const parentHost = window.location.hostname || "localhost";

const liveBanner = document.getElementById("live-banner");
const liveTitleEl = document.getElementById("live-title");
const liveViewersEl = document.getElementById("live-viewers");
const watchLayout = document.getElementById("watch-layout");
const livePlayerSection = document.getElementById("live-player-section");
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

// Side stream: itzon.tv's own /embed/<channel> endpoint, shown in a small
// floating window. The Twitch player keeps running untouched alongside it.
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
  sidestreamFrame.src = open ? `https://itzon.tv/embed/${CHANNEL}` : "";
}

sidestreamToggle.addEventListener("click", () => setSidestream(!isSidestreamOpen));
sidestreamClose.addEventListener("click", () => setSidestream(false));

async function checkLive() {
  try {
    const res = await fetch("/api/live");
    const data = await res.json();

    if (data.live) {
      liveBanner.classList.remove("is-hidden");
      liveTitleEl.textContent = data.title || "";
      liveViewersEl.textContent = data.viewers ? `${data.viewers.toLocaleString()} watching` : "";

      if (!isLiveEmbedded) {
        livePlayerFrame.src = `https://player.twitch.tv/?channel=${CHANNEL}&parent=${parentHost}&muted=false`;
        livePlayerSection.classList.remove("is-hidden");
        watchLayout.classList.add("is-live");
        isLiveEmbedded = true;
      }
    } else {
      liveBanner.classList.add("is-hidden");
      livePlayerSection.classList.add("is-hidden");
      watchLayout.classList.remove("is-live");
      if (isLiveEmbedded) {
        livePlayerFrame.src = "";
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
        <div class="vod-card__player" data-video-id="${vod.id}">
          <img
            src="${vod.thumbnailUrl}"
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

vodsGrid.addEventListener("click", (e) => {
  const playerEl = e.target.closest(".vod-card__player");
  if (!playerEl || playerEl.classList.contains("is-loaded")) return;

  const videoId = playerEl.dataset.videoId;
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
setInterval(checkLive, LIVE_POLL_MS);
