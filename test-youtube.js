module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return response.status(500).json({
      ok: false,
      stage: 'config',
      error: 'YOUTUBE_API_KEY is not configured in Vercel'
    });
  }

  const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    part: 'snippet',
    q: 'cake dessert recipe',
    type: 'video',
    order: 'viewCount',
    maxResults: '3',
    publishedAfter,
    key: apiKey
  });

  try {
    const youtubeResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const body = await youtubeResponse.json();

    if (!youtubeResponse.ok) {
      return response.status(502).json({
        ok: false,
        stage: 'youtube',
        error: body.error?.message || 'YouTube API request failed',
        reason: body.error?.errors?.[0]?.reason || null
      });
    }

    const videos = (body.items || []).map(item => ({
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));

    return response.status(200).json({
      ok: true,
      stage: 'youtube',
      count: videos.length,
      videos
    });
  } catch (error) {
    console.error('YouTube test failed:', error);
    return response.status(500).json({
      ok: false,
      stage: 'network',
      error: 'Could not reach YouTube API'
    });
  }
};
