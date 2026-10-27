module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({
      ok: false,
      error: "Only GET requests are allowed"
    });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return response.status(500).json({
      ok: false,
      stage: "config",
      error: "YOUTUBE_API_KEY is not configured in Vercel"
    });
  }

  try {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: "3",
      q: "dessert recipe",
      order: "date",
      key: apiKey
    });

    const youtubeResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params.toString()}`
    );

    const data = await youtubeResponse.json();

    if (!youtubeResponse.ok) {
      return response.status(youtubeResponse.status).json({
        ok: false,
        stage: "youtube",
        error: data.error?.message || "YouTube API request failed",
        reason: data.error?.errors || null
      });
    }

    const videos = (data.items || []).map((item) => ({
      id: item.id?.videoId || null,
      title: item.snippet?.title || "",
      channel: item.snippet?.channelTitle || "",
      publishedAt: item.snippet?.publishedAt || ""
    }));

    return response.status(200).json({
      ok: true,
      stage: "youtube",
      count: videos.length,
      videos
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      stage: "runtime",
      error: error.message
    });
  }
};
