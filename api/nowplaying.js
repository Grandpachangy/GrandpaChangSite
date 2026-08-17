// Reads the "now playing" track from Last.fm. Scrobblers report the current
// track there, so this covers Spotify (native scrobbling) and YouTube /
// YouTube Music (via a scrobbler extension) through one endpoint.
// Reading public scrobbles needs only an API key -- no OAuth.
//
// Last.fm answers "what" accurately and "whether it is still playing" poorly:
// a scrobbler announces a track and cannot retract it, so a paused track keeps
// reading as playing until the entry expires by itself. The play/pause signal
// from api/playstate.js covers that gap where it is available, and where it is
// not this behaves exactly as it always has.

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
      // Three, so that when the pause signal overrides a still-live
      // now-playing entry there is a real, dated scrobble behind it to show
      // instead. With one, the only thing available was the entry being
      // overridden.
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

    // Only asked when there is something for it to contradict. Since the signal
    // can only switch the card off, it has nothing to say while Last.fm already
    // reports nothing playing -- and that is the state the site sits in most of
    // the day. Skipping the lookup there is the difference between a KV read on
    // every revalidation around the clock and one only while music is on, which
    // on a free tier is the difference between fitting and not.
    const wantsSignal = Boolean(nowPlaying) || Boolean(req.query && req.query.diag);
    const live = wantsSignal ? await readPlayState() : null;

    // The signal can switch the card off. It cannot switch it on.
    //
    // Off is the whole point and is safe: the browser playing the music said it
    // paused, which is better evidence than an entry Last.fm has not got round
    // to expiring. On would mean claiming a track is playing before Last.fm
    // knows about it -- and the only track available to name at that moment is
    // the previous one, so it would confidently show the wrong song. Waiting
    // for Last.fm to catch up costs a few seconds and cannot be wrong.
    const paused = Boolean(live && live.state === "paused");
    const track = paused ? lastScrobble || nowPlaying : nowPlaying || lastScrobble;

    if (req.query && req.query.diag) {
      res.status(200).json({
        configured: true,
        diag: {
          lastfmSaysPlaying: Boolean(nowPlaying),
          // null when the userscript is not set up, unreachable or stale, in
          // which case nothing below it applies and Last.fm stands alone.
          playStateSignal: live ? live.state : null,
          playStateAgeSec: live ? Math.round((Date.now() - live.at) / 1000) : null,
          overrodeToPaused: paused && Boolean(nowPlaying),
          // For comparing the raw player title against Last.fm's cleaned one
          // before deciding whether to ever render the former.
          playerTitle: live ? live.title : null,
          playerArtist: live ? live.artist : null,
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
