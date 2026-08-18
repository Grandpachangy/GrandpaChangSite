// Reads the "now playing" track from Last.fm. Scrobblers report the current
// track there, so this covers Spotify (native scrobbling) and YouTube /
// YouTube Music (via a scrobbler extension) through one endpoint.
// Reading public scrobbles needs only an API key -- no OAuth.

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
      "&format=json&limit=1";

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Last.fm request failed: ${response.status}`);
    }

    const data = await response.json();
    const track = data && data.recenttracks && data.recenttracks.track
      ? [].concat(data.recenttracks.track)[0]
      : null;

    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=10");

    // Nothing scrobbled at all: nothing to show either way.
    if (!track) {
      res.status(200).json({ configured: true, playing: false, track: null });
      return;
    }

    const isNowPlaying = Boolean(
      track["@attr"] && track["@attr"].nowplaying === "true"
    );

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
