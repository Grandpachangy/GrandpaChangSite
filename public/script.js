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
        watchLayout.classList.remove("chat-only");
        isLiveEmbedded = true;
      }
    } else {
      liveBanner.classList.add("is-hidden");
      livePlayerSection.classList.add("is-hidden");
      watchLayout.classList.add("chat-only");
      if (isLiveEmbedded) {
        livePlayerFrame.src = "";
        isLiveEmbedded = false;
        setPoppedOut(false);
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
      vodsStatus.textContent = "No VODs found yet.";
      return;
    }

    vodsStatus.classList.add("is-hidden");

    vodsGrid.innerHTML = data.vods
      .map(
        (vod) => `
      <article class="vod-card">
        <div class="vod-card__player" data-video-id="${vod.id}">
          <img src="${vod.thumbnailUrl}" alt="" loading="lazy" />
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
  } catch (err) {
    vodsStatus.textContent = "Couldn't load VODs right now.";
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

watchLayout.classList.add("chat-only");

function loadChat() {
  if (liveChatFrame.src) return;
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
