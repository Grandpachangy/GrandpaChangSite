// ==UserScript==
// @name         GrandpaChang play state
// @namespace    https://grandpachang.com/
// @version      2.0
// @description  Tells grandpachang.com when YouTube playback pauses, which Last.fm has no way to report.
// @match        https://www.youtube.com/*
// @match        https://music.youtube.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * Why this exists
 * ---------------
 * Last.fm is told when a track starts and never when it stops -- there is no
 * API for it. So a paused track keeps reading as "now playing" until Last.fm
 * expires the entry by itself: measured at 2m41s for a three-and-a-half minute
 * song, and 4h43m for a long mix. The only thing that knows a pause happened
 * is this tab, so this reports it.
 *
 * Scrobbling is untouched. Web Scrobbler still does that, and is far better at
 * reading messy YouTube titles than anything here would be.
 *
 * v2 uses a plain fetch with @grant none. v1 went through GM_xmlhttpRequest to
 * avoid putting CORS on the site, which made the request depend on Tampermonkey's
 * cross-origin permissions -- and that is precisely what Brave's shields and the
 * extension permission prompts kept interfering with, invisibly. The endpoint
 * allows cross-origin posts now, so the browser can send this itself.
 *
 * The token travels in the body, not a header, and the content type is
 * text/plain. That makes it a "simple request" in CORS terms, which the browser
 * sends directly with no preflight -- one fewer round trip, and nothing extra
 * for a blocker to stop.
 */

(function () {
  "use strict";

  const ENDPOINT = "https://grandpachang.com/api/playstate";
  const TOKEN = "PASTE_YOUR_TOKEN_HERE";

  // While playing, re-send periodically. The server drops the state after 90
  // seconds, so a browser that is closed or crashes stops being believed
  // rather than pinning the card forever -- the exact failure being fixed.
  const HEARTBEAT_MS = 15 * 1000;
  // YouTube is a single-page app and swaps the <video> element out from under
  // any listener attached to it, so polling the current one is steadier than
  // re-attaching handlers on every navigation.
  const POLL_MS = 1000;

  if (TOKEN === "PASTE_YOUR_TOKEN_HERE") {
    console.warn("[GrandpaChang] No token set -- edit the userscript and add it.");
    return;
  }

  let lastSent = null;
  let lastSentAt = 0;

  function currentVideo() {
    // The one actually playing audio, not a muted preview tile on the home page.
    const videos = Array.from(document.querySelectorAll("video"));
    return videos.find((v) => !v.paused && v.readyState > 2) || videos[0] || null;
  }

  function text(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : "";
  }

  function send(state) {
    fetch(ENDPOINT, {
      method: "POST",
      // Deliberately text/plain: application/json would trigger a preflight.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        token: TOKEN,
        state,
        title:
          text("ytmusic-player-bar .title") ||
          text("h1.ytd-watch-metadata") ||
          document.title,
        artist:
          text("ytmusic-player-bar .byline a") || text("ytd-channel-name a"),
        source: location.hostname,
      }),
      keepalive: true,
    })
      .then((r) => {
        if (!r.ok) console.warn("[GrandpaChang] rejected:", r.status);
        else console.debug("[GrandpaChang] sent:", state);
      })
      .catch((err) => console.warn("[GrandpaChang] post failed:", err.message));

    lastSent = state;
    lastSentAt = Date.now();
  }

  function tick() {
    const video = currentVideo();
    // No player on this page at all -- the home page, search results. Says
    // nothing about whether music is running elsewhere, so stay quiet.
    if (!video) return;

    const state = video.paused || video.ended ? "paused" : "playing";
    const changed = state !== lastSent;
    const due = Date.now() - lastSentAt > HEARTBEAT_MS;

    // A change goes immediately; otherwise only often enough to stay alive.
    if (changed || due) send(state);
  }

  setInterval(tick, POLL_MS);
  tick();

  // keepalive above lets this survive the tab closing. When it does not, the
  // state expires by itself within 90 seconds.
  window.addEventListener("pagehide", () => {
    if (lastSent === "playing") send("paused");
  });
})();
