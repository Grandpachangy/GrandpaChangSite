// ==UserScript==
// @name         GrandpaChang play state
// @namespace    https://grandpachang.com/
// @version      1.0
// @description  Tells grandpachang.com when YouTube playback pauses, which Last.fm has no way to report.
// @match        https://www.youtube.com/*
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @connect      grandpachang.com
// @run-at       document-idle
// ==/UserScript==

/*
 * Why this exists
 * ---------------
 * Last.fm is told when a track starts and never when it stops -- there is no
 * API for it. So a paused track keeps reading as "now playing" until Last.fm
 * expires the entry by itself, measured at 2m41s for a three-and-a-half minute
 * song and hours for a long mix.
 *
 * The only thing that knows a pause happened is this tab. This reports it.
 *
 * Scrobbling is untouched: Web Scrobbler keeps doing that, and it is far
 * better at reading messy YouTube titles than anything written here would be.
 * This only reports whether audio is running.
 *
 * Setup: put your token below. It must match PLAYSTATE_TOKEN in Vercel.
 */

(function () {
  "use strict";

  const ENDPOINT = "https://grandpachang.com/api/playstate";
  const TOKEN = "PASTE_YOUR_TOKEN_HERE";

  // While playing, re-send periodically. The server expires the state after 90
  // seconds, so a browser that is closed or crashes stops being believed
  // rather than pinning the card forever -- the exact failure being fixed.
  const HEARTBEAT_MS = 15 * 1000;
  // How often to look at the player. YouTube is a single-page app and swaps
  // the <video> element out from under any listener attached to it, so polling
  // the current one is steadier than re-attaching handlers on navigation.
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

  function playerTitle() {
    const el =
      document.querySelector("ytmusic-player-bar .title") ||
      document.querySelector("h1.ytd-watch-metadata") ||
      document.querySelector("h1.title");
    return el ? el.textContent.trim() : document.title;
  }

  function playerArtist() {
    const el =
      document.querySelector("ytmusic-player-bar .byline a") ||
      document.querySelector("ytd-channel-name a");
    return el ? el.textContent.trim() : "";
  }

  function send(state) {
    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: {
        "Content-Type": "application/json",
        "x-playstate-token": TOKEN,
      },
      data: JSON.stringify({
        state,
        title: playerTitle(),
        artist: playerArtist(),
        source: location.hostname,
      }),
      onerror: () => console.warn("[GrandpaChang] play state post failed"),
    });
    lastSent = state;
    lastSentAt = Date.now();
  }

  function tick() {
    const video = currentVideo();
    // No player on this page at all -- the home page, search results. Says
    // nothing about whether music is running in another tab, so stay quiet.
    if (!video) return;

    const state = video.paused || video.ended ? "paused" : "playing";
    const changed = state !== lastSent;
    const due = Date.now() - lastSentAt > HEARTBEAT_MS;

    // A change goes immediately; otherwise only often enough to stay alive.
    if (changed || due) send(state);
  }

  setInterval(tick, POLL_MS);
  tick();

  // Best effort on tab close. It often lands, and when it does not the state
  // expires on its own within 90 seconds.
  window.addEventListener("pagehide", () => {
    if (lastSent === "playing") send("paused");
  });
})();
