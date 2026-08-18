// Reads the "now playing" track from Last.fm. Scrobblers report the current
// track there, so this covers Spotify (native scrobbling) and YouTube /
// YouTube Music (via a scrobbler extension) through one endpoint.
// Reading public scrobbles needs only an API key -- no OAuth.
//
// Last.fm answers "what" well and "is it still playing" badly: an announced
// track cannot be retracted, so a paused one keeps reading as playing until the
// entry expires by itself. Web Scrobbler's webhook covers that where it is set
// up (api/scrobbler-hook.js), and where it is not this behaves exactly as it
// always has.

const { readPlayState } = require("./_playstate");

module.exports = async (req, res) => {
  const user = process.env.LASTFM_USER;
  const apiKey = process.env.LASTFM_API_KEY;

  // Not configured yet: report it plainly so the widget stays hidden rather
  // than surfacing an error to visitors.
  if (!user || !apiKey) {
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(200).json({ configured: false, playing: false });
    return;
  }

  try {
    const url =
      "https://ws.audioscrobbler.com/2.0/" +
      "?method=user.getrecenttracks" +
      `&user=${encodeURIComponent(user)}` +
      `&api_key=${encodeURIComponent(apiKey)}` +
      // Three, so that when a pause overrides a still-live now-playing entry
      // there is a real, dated scrobble behind it to show instead.
      "&format=json&limit=3";

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Last.fm request failed: ${response.status}`);
    }

    const data = await response.json();
    const tracks =
      data && data.recenttracks && data.recenttracks.track
        ? [].concat(data.recenttracks.track)
        : [];

    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=10");

    const nowPlaying = tracks.find(
      (t) => t["@attr"] && t["@attr"].nowplaying === "true"
    );
    const lastScrobble = tracks.find((t) => t.date && t.date.uts);

    // Skipped when there is plainly nothing going on, because a lookup on every
    // revalidation around the clock would run past the free tier's command
    // budget. "Plainly nothing" has to mean more than "Last.fm reports nothing
    // playing", though: after a pause Last.fm's entry expires and is never
    // re-announced, so a resumed track has no entry at all -- and gating on one
    // meant the signal that could have switched the card back on was never
    // read. A scrobble within the hour is the wider net.
    const SESSION_WINDOW_MS = 60 * 60 * 1000;
    const scrobbleAgeMs = lastScrobble
      ? Date.now() - Number(lastScrobble.date.uts) * 1000
      : null;
    const maybeListening =
      Boolean(nowPlaying) ||
      (scrobbleAgeMs !== null && scrobbleAgeMs < SESSION_WINDOW_MS);
    const live =
      maybeListening || (req.query && req.query.diag) ? await readPlayState() : null;

    const paused = Boolean(live && live.state === "paused");

    // The same track either way -- pausing changes the label, not the subject.
    // Falling back to the previous scrobble when paused named the wrong song:
    // the track just paused has not been scrobbled yet, since Last.fm only
    // records one partway through, so the card announced whatever came before
    // it. Last.fm's now-playing entry is the track that was actually paused,
    // and it carries the artwork and link that the webhook's plain text does
    // not.
    const track = nowPlaying || lastScrobble;

    if (req.query && req.query.diag) {
      res.status(200).json({
        configured: true,
        diag: {
          lastfmSaysPlaying: Boolean(nowPlaying),
          webhookSignal: live ? live.state : null,
          webhookEvent: live ? live.event : null,
          webhookAgeSec: live ? Math.round((Date.now() - live.at) / 1000) : null,
          overrodeToPaused: paused && Boolean(nowPlaying),
          webhookTitle: live ? live.title : null,
          webhookArtist: live ? live.artist : null,
          lastfmTitle: (nowPlaying || lastScrobble || {}).name || null,
        },
      });
      return;
    }

    // Nothing scrobbled at all: nothing to show either way.
    if (!track) {
      res.status(200).json({ configured: true, playing: false, track: null });
      return;
    }

    // Switching the card on from the signal, not only off.
    //
    // The original rule was off-only, on the grounds that naming a track before
    // Last.fm knew about it meant naming the previous one. That turned out to
    // strand a resumed track: Last.fm's entry expires during the pause and Web
    // Scrobbler never re-announces it, so nothing could put the card back.
    //
    // Naming is not the problem it was, because the event carries the title.
    // The card is only switched on when that title matches the track about to
    // be shown -- Last.fm is still the one naming it, and the signal only
    // confirms that this is what is running. A mismatch falls through to off,
    // which is the safe direction.
    //
    // The freshness bound is what stops a browser that was closed mid-track,
    // and so never sent a pause, from pinning the card. A long mix stays alive
    // through it because Last.fm scrobbles partway through and that event
    // refreshes the timestamp.
    const SIGNAL_FRESH_MS = 30 * 60 * 1000;
    const sameTrack =
      live &&
      live.title &&
      track.name &&
      live.title.trim().toLowerCase() === track.name.trim().toLowerCase();
    const signalSaysPlaying =
      live &&
      live.state === "playing" &&
      Date.now() - live.at < SIGNAL_FRESH_MS &&
      sameTrack;

    const isNowPlaying =
      !paused &&
      (Boolean(track["@attr"] && track["@attr"].nowplaying === "true") ||
        Boolean(signalSaysPlaying));

    const images = Array.isArray(track.image) ? track.image : [];
    const preferred =
      images.find((i) => i.size === "large") ||
      images.find((i) => i.size === "medium") ||
      images[images.length - 1] ||
      {};
    const art = typeof preferred["#text"] === "string" ? preferred["#text"] : "";

    // A scrobble carries its own timestamp. A now-playing entry does not -- so
    // when one is being shown as paused, the moment the pause was reported is
    // the honest answer for "when", and it is the one the viewer means anyway.
    const playedAt =
      track.date && track.date.uts
        ? Number(track.date.uts)
        : paused && live && live.at
          ? Math.floor(live.at / 1000)
          : null;

    // The most recent track is returned either way; `playing` says whether it
    // is live right now or the last thing scrobbled.
    res.status(200).json({
      configured: true,
      playing: isNowPlaying,
      title: track.name || "",
      artist: (track.artist && track.artist["#text"]) || "",
      album: (track.album && track.album["#text"]) || "",
      // Only pass through http(s) art URLs.
      art: /^https?:\/\//i.test(art) ? art : null,
      url: /^https?:\/\//i.test(track.url || "") ? track.url : null,
      playedAt: isNowPlaying ? null : playedAt,
    });
  } catch (err) {
    console.error("nowplaying endpoint failed:", err);
    res.status(500).json({ error: "Unable to fetch now playing" });
  }
};
