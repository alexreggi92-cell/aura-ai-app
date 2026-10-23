const SEARCH_QUERIES = [
  { query: 'торты десерты выпечка', category: 'Кулинария' },
  { query: 'украшение торта cake decorating', category: 'Торты' },
  { query: 'шоколадный десерт chocolate dessert', category: 'Шоколад' },
  { query: 'клубничный десерт strawberry dessert', category: 'Десерты' },
  { query: 'день рождения торт birthday cake', category: 'День рождения' }
];

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function getOrCreateYouTubeSource(baseUrl, key) {
  const lookup = await fetch(
    `${baseUrl}/rest/v1/trend_sources?name=eq.YouTube&select=id&limit=1`,
    { headers: supabaseHeaders(key) }
  );
  if (!lookup.ok) throw new Error(`Supabase source lookup failed: ${lookup.status}`);
  const found = await lookup.json();
  if (found[0]?.id) return found[0].id;

  const created = await fetch(`${baseUrl}/rest/v1/trend_sources`, {
    method: 'POST',
    headers: supabaseHeaders(key, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      name: 'YouTube',
      source_type: 'official_api',
      api_url: 'https://www.googleapis.com/youtube/v3',
      is_active: true
    })
  });
  if (!created.ok) throw new Error(`Supabase source create failed: ${created.status}`);
  const rows = await created.json();
  return rows[0].id;
}

async function searchYouTube(query, category, apiKey) {
  const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'viewCount',
    maxResults: '10',
    publishedAfter,
    relevanceLanguage: 'ru',
    regionCode: 'RU',
    key: apiKey
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  const body = await response.json();
  if (!response.ok) throw new Error(`YouTube search failed: ${body.error?.message || response.status}`);
  return (body.items || []).map(item => ({
    videoId: item.id.videoId,
    category,
    title: item.snippet.title,
    description: item.snippet.description || '',
    channelTitle: item.snippet.channelTitle || '',
    publishedAt: item.snippet.publishedAt,
    previewUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
    videoUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`
  }));
}

async function getVideoStatistics(videoIds, apiKey) {
  if (!videoIds.length) return new Map();
  const params = new URLSearchParams({
    part: 'statistics',
    id: videoIds.join(','),
    key: apiKey
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  const body = await response.json();
  if (!response.ok) throw new Error(`YouTube statistics failed: ${body.error?.message || response.status}`);
  return new Map((body.items || []).map(item => [item.id, item.statistics || {}]));
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.authorization !== `Bearer ${cronSecret}`) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  const youtubeKey = process.env.YOUTUBE_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!youtubeKey || !supabaseUrl || !supabaseKey) {
    return response.status(500).json({ error: 'Importer environment variables are not configured' });
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const run = { found_count: 0, added_count: 0, duplicate_count: 0, error_count: 0 };

  try {
    const sourceId = await getOrCreateYouTubeSource(baseUrl, supabaseKey);
    const collected = [];
    for (const item of SEARCH_QUERIES) {
      const videos = await searchYouTube(item.query, item.category, youtubeKey);
      collected.push(...videos);
    }

    const unique = [...new Map(collected.map(item => [item.videoId, item])).values()];
    run.found_count = unique.length;
    const stats = await getVideoStatistics(unique.map(item => item.videoId), youtubeKey);

    const rows = unique.map(item => {
      const stat = stats.get(item.videoId) || {};
      const views = Number(stat.viewCount || 0);
      const likes = Number(stat.likeCount || 0);
      return {
        source_id: sourceId,
        external_id: item.videoId,
        title: item.title,
        description: `${item.description}\nКанал: ${item.channelTitle}`.slice(0, 4000),
        category: item.category,
        preview_url: item.previewUrl,
        video_url: item.videoUrl,
        preset_id: null,
        provider: 'youtube',
        face_required: false,
        media_type: 'video',
        aspect_ratio: '16:9',
        duration_seconds: 0,
        price: 0,
        is_hot: views >= 100000 || likes >= 5000,
        status: 'published',
        usage_count: views
      };
    });

    if (rows.length) {
      const insert = await fetch(`${baseUrl}/rest/v1/trends?on_conflict=source_id,external_id`, {
        method: 'POST',
        headers: supabaseHeaders(supabaseKey, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(rows)
      });
      if (!insert.ok) {
        const text = await insert.text();
        throw new Error(`Supabase trend upsert failed: ${insert.status} ${text}`);
      }
      run.added_count = rows.length;
    }

    await fetch(`${baseUrl}/rest/v1/trend_sources?id=eq.${sourceId}`, {
      method: 'PATCH',
      headers: supabaseHeaders(supabaseKey),
      body: JSON.stringify({ last_sync_at: new Date().toISOString() })
    });

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({ ok: true, source: 'youtube', ...run });
  } catch (error) {
    console.error('YouTube importer failed:', error);
    return response.status(500).json({ error: error.message, ...run });
  }
};
