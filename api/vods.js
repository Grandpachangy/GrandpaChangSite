const { getBroadcasterId, twitchFetch } = require("./_twitch");

module.exports = async (req, res) => {
  try {
    const broadcasterId = await getBroadcasterId();
    const data = await twitchFetch(
      `/videos?user_id=${broadcasterId}&type=archive&first=12&sort=time`
    );

    const vods = data.data.map((v) => ({
      id: v.id,
      title: v.title,
      publishedAt: v.published_at,
      duration: v.duration,
      viewCount: v.view_count,
      thumbnailUrl: v.thumbnail_url
        .replace("%{width}", "440")
        .replace("%{height}", "248"),
      url: v.url,
    }));

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(200).json({ vods });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
