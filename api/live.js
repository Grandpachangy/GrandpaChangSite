const { CHANNEL_LOGIN, twitchFetch } = require("./_twitch");

module.exports = async (req, res) => {
  try {
    const data = await twitchFetch(`/streams?user_login=${CHANNEL_LOGIN}`);
    const stream = data.data[0] || null;

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=30");
    res.status(200).json({
      live: Boolean(stream),
      title: stream ? stream.title : null,
      game: stream ? stream.game_name : null,
      viewers: stream ? stream.viewer_count : null,
      startedAt: stream ? stream.started_at : null,
      thumbnailUrl: stream
        ? stream.thumbnail_url.replace("{width}", "640").replace("{height}", "360")
        : null,
    });
  } catch (err) {
    // Log the detail server-side; don't echo upstream error bodies to clients.
    console.error("live endpoint failed:", err);
    res.status(500).json({ error: "Unable to fetch live status" });
  }
};
