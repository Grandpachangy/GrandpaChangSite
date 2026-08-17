// Reads the "now playing" track from Last.fm. Scrobblers report the current
// track there, so this covers Spotify (native scrobbling) and YouTube /
// YouTube Music (via a scrobbler extension) through one endpoint.
// Reading public scrobbles needs only an API key -- no OAuth.

// How long a "now playing" entry is believed once nothing new has been
// scrobbled behind it.
//
// Last.fm holds a now-playing entry until a scrobbler replaces it. Close the
// player mid-track and that replacement never comes, so the entry sits there
// indefinitely -- which is why the card read "Now playing" for hours after the
// music stopped. The entry carries no timestamp, so it cannot say how old it
// is on its own.
//
// The history behind it can. A scrobbler that is alive keeps scrobbling: Last.fm
// records a track once it has played for four minutes or half its length,
// whichever comes first, so even an hour-long mix lands a scrobble minutes in.
// A now-playing claim with hours of silence behind it is therefore a scrobbler
// that went away, not music that is still going.
//
// The age of the last scrobble is not enough on its own, which the first
// version of this got wrong. Put music on after a few hours away and the new
// track is genuinely playing while the newest scrobble is still hours old --
// Last.fm does not record the new one for about four minutes -- so judging by
// that age alone suppressed real music for exactly as long as it took to
// prove itself. Resuming after a break and never having stopped look identical
// from the scrobble history.
//
// What tells them apart is whether the entry is the same one. A stuck entry
// never changes; someone putting music on changes it immediately. So the entry
// is only doubted once it has sat there unchanged AND nothing has scrobbled
// behind it for that whole time.
//
// Three hours, because a single long track is genuinely indistinguishable from
// a stuck one. Last.fm records a track once, minutes in, and then nothing more
// until it ends -- so an hour into a two-hour set the history looks exactly
// like an entry nobody is updating. There is no signal in this API that
// separates them. The window is therefore set past any plausible single track
// rather than at the point of suspicion: being slow to notice music stopped is
// a small wrong, and hiding music that is playing is a bigger one.
const NOWPLAYING_TRUST_MS = 3 * 60 * 60 * 1000;

// The entry currently being watched, and when it first appeared. Module scope,
// so a recycled instance forgets and gives a stuck entry the benefit of the
// doubt again -- which is the right way for this to fail, and costs nothing
// while anyone is on the page, since it is polled every few seconds.
let seenKey = null;
let seenAt = 0;

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
      // Three, not one. A now-playing entry occupies the first slot, so asking
      // for a single track hid the completed scrobbles behind it -- both the
      // evidence needed to tell a live entry from a stuck one, and the track to
      // fall back to when it is stuck.
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
    // The most recent thing actually finished and recorded, which is the only
    // dated point of reference in the response.
    const lastScrobble = tracks.find((t) => t.date && t.date.uts);
    const scrobbleAgeMs = lastScrobble
      ? Date.now() - Number(lastScrobble.date.uts) * 1000
      : null;

    // Track identity, so a changed entry resets the clock.
    const key = nowPlaying
      ? `${(nowPlaying.artist && nowPlaying.artist["#text"]) || ""} - ${nowPlaying.name || ""}`
      : null;
    if (key && key !== seenKey) {
      seenKey = key;
      seenAt = Date.now();
    }
    const heldForMs = key ? Date.now() - seenAt : 0;

    // Both conditions, not either. Unchanged for the whole window says the
    // scrobbler is not updating it; silence behind it says the scrobbler is not
    // recording anything either. One without the other is ordinary listening.
    const stale =
      Boolean(nowPlaying) &&
      heldForMs > NOWPLAYING_TRUST_MS &&
      (scrobbleAgeMs === null || scrobbleAgeMs > NOWPLAYING_TRUST_MS);

    const track = stale ? lastScrobble : nowPlaying || lastScrobble || null;

    if (req.query && req.query.diag) {
      // Timings and flags only -- no key, no user.
      res.status(200).json({
        configured: true,
        diag: {
          tracks: tracks.length,
          hasNowPlaying: Boolean(nowPlaying),
          // How long this exact entry has been sat there. Resets when the
          // track changes, which is what separates a stuck entry from someone
          // putting music on after a long break.
          heldForSec: Math.round(heldForMs / 1000),
          lastScrobbleAgeSec:
            scrobbleAgeMs === null ? null : Math.round(scrobbleAgeMs / 1000),
          trustWindowSec: NOWPLAYING_TRUST_MS / 1000,
          treatedAsStale: stale,
        },
      });
      return;
    }

    // Nothing scrobbled at all: nothing to show either way.
    if (!track) {
      res.status(200).json({ configured: true, playing: false, track: null });
      return;
    }

    // When the now-playing entry was judged stale, `track` is the last scrobble
    // instead -- which carries a date and no nowplaying flag, so this would read
    // false anyway. The explicit check states the rule rather than leaning on
    // that coincidence.
    const isNowPlaying =
      !stale && Boolean(track["@attr"] && track["@attr"].nowplaying === "true");

    const images = Array.isArray(track.image) ? track.image : [];
    const preferred =
      images.find((i) => i.size === "large") ||
      images.find((i) => i.size === "medium") ||
      images[images.length - 1] ||
      {};
    const art = typeof preferred["#text"] === "string" ? preferred["#text"] : "";
    const playedAt =
      track.date && track.date.uts ? Number(track.date.uts) : null;

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
