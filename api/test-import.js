module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ ok: false, error: 'Only GET requests are allowed' });
  }

  const result = {
    ok: false,
    stages: {}
  };

  const youtubeKey = process.env.YOUTUBE_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  result.stages.environment = {
    youtubeKey: Boolean(youtubeKey),
    supabaseUrl: Boolean(supabaseUrl),
    supabaseSecretKey: Boolean(supabaseKey)
  };

  if (!youtubeKey || !supabaseUrl || !supabaseKey) {
    return response.status(500).json({
      ...result,
      error: 'One or more importer environment variables are missing'
    });
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json'
  };

  try {
    const sourceResponse = await fetch(
      `${baseUrl}/rest/v1/trend_sources?select=id,name&limit=1`,
      { headers }
    );
    const sourceText = await sourceResponse.text();
    result.stages.trend_sources = {
      status: sourceResponse.status,
      ok: sourceResponse.ok,
      body: sourceResponse.ok ? JSON.parse(sourceText || '[]') : sourceText.slice(0, 500)
    };

    const trendsResponse = await fetch(
      `${baseUrl}/rest/v1/trends?select=id,source_id,external_id&limit=1`,
      { headers }
    );
    const trendsText = await trendsResponse.text();
    result.stages.trends = {
      status: trendsResponse.status,
      ok: trendsResponse.ok,
      body: trendsResponse.ok ? JSON.parse(trendsText || '[]') : trendsText.slice(0, 500)
    };

    const youtubeParams = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: '1',
      q: 'dessert recipe',
      key: youtubeKey
    });
    const youtubeResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${youtubeParams.toString()}`
    );
    const youtubeText = await youtubeResponse.text();
    let youtubeBody;
    try {
      youtubeBody = JSON.parse(youtubeText || '{}');
    } catch {
      youtubeBody = { raw: youtubeText.slice(0, 500) };
    }
    result.stages.youtube = {
      status: youtubeResponse.status,
      ok: youtubeResponse.ok,
      count: youtubeBody.items?.length || 0,
      error: youtubeResponse.ok ? null : youtubeBody.error?.message || 'YouTube request failed'
    };

    result.ok = sourceResponse.ok && trendsResponse.ok && youtubeResponse.ok;
    return response.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return response.status(500).json({
      ...result,
      error: error.message
    });
  }
};
