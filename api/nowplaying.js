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

    // Only asked when there is something for it to contradict. The signal can
    // only switch the card off, so it has nothing to say while Last.fm already
    // reports nothing playing -- which is most of the day. Skipping the lookup
    // there keeps this within the free tier's command budget.
    const live =
      nowPlaying || (req.query && req.query.diag) ? await readPlayState() : null;

    // The signal can switch the card off. It cannot switch it on.
    //
    // Off is the point and is safe: Web Scrobbler said playback stopped, which
    // is better evidence than an entry Last.fm has not expired. On would mean
    // naming a track before Last.fm knows about it, and the only one available
    // to name then is the previous one -- confidently the wrong song.
    const paused = Boolean(live && live.state === "paused");
    const track = paused ? lastScrobble || nowPlaying : nowPlaying || lastScrobble;

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

    const isNowPlaying =
      !paused && Boolean(track["@attr"] && track["@attr"].nowplaying === "true");

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
