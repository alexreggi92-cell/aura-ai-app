export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return response.status(500).json({ error: 'Supabase environment variables are not configured' });
  }

  const query = new URLSearchParams({
    select: 'id,title,description,category,preview_url,video_url,preset_id,provider,face_required,media_type,aspect_ratio,duration_seconds,price,is_hot,status,usage_count,created_at',
    status: 'eq.published',
    order: 'is_hot.desc,created_at.desc'
  });

  try {
    const upstream = await fetch(`${supabaseUrl.replace(/\\/$/, '')}/rest/v1/trends?${query.toString()}`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json'
      }
    });

    const body = await upstream.text();
    if (!upstream.ok) {
      return response.status(upstream.status).json({ error: 'Supabase request failed', details: body });
    }

    const trends = JSON.parse(body);
    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({ trends });
  } catch (error) {
    console.error('GET /api/trends failed', error);
    return response.status(500).json({ error: 'Unable to load trends' });
  }
}
