const HIGGSFIELD_KEY = 'HF_CREDENTIALS';
const GENJUTSU_ENDPOINT = 'https://api.higgsfield.ai/higgsfield/genjutsu/motion-transfer/v1.0';
const KLING_ENDPOINT = 'https://api.higgsfield.ai/kling-video/v3/motion-control/pro';

function jsonHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function bearer(request) {
  const value = request.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function getUser(request) {
  const token = bearer(request);
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !base || !key) return null;
  const response = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  return response.json();
}

async function supabase(requestPath, options = {}) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('Supabase server variables are not configured');
  return fetch(`${base}/rest/v1/${requestPath}`, {
    ...options,
    headers: jsonHeaders(key, options.headers || {})
  });
}

async function callHiggsfield(model, input) {
  const credential = process.env[HIGGSFIELD_KEY];
  if (!credential) throw new Error('HF_CREDENTIALS is not configured');
  let endpoint;
  let body;
  if (model === 'genjutsu-lite' || model === 'genjutsu') {
    endpoint = GENJUTSU_ENDPOINT;
    body = {
      video_url: input.video_url,
      image_urls: [input.image_url],
      prompt: input.prompt || '',
      resolution: input.resolution || '720p'
    };
  } else if (model === 'kling-motion-control' || model === 'kling-3-motion-control') {
    endpoint = KLING_ENDPOINT;
    body = {
      prompt: input.prompt || '',
      image_url: input.image_url,
      video_url: input.video_url,
      keep_original_sound: 'yes',
      character_orientation: 'image'
    };
  } else if (model === 'image') {
    if (!process.env.HF_IMAGE_ENDPOINT) {
      const error = new Error('Image provider endpoint is not configured yet');
      error.statusCode = 501;
      throw error;
    }
    endpoint = process.env.HF_IMAGE_ENDPOINT;
    body = {
      prompt: input.prompt || '',
      image_urls: [input.image_url]
    };
  } else {
    const error = new Error(`Unsupported model_id: ${model}`);
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Key ${credential}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 3000) }; }
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Higgsfield request failed: ${response.status}`);
    error.statusCode = response.status;
    error.provider = data;
    throw error;
  }
  return { endpoint, data };
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' });

  const user = await getUser(request);
  if (!user?.id) return response.status(401).json({ ok: false, error: 'Sign in is required' });

  const body = request.body || {};
  if (body.confirm !== 'GENERATE') {
    return response.status(400).json({ ok: false, error: 'Generation is locked. Send confirm="GENERATE".' });
  }

  const presetId = typeof body.preset_id === 'string' ? body.preset_id.trim() : '';
  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
  if (!presetId || !/^https:\/\//i.test(imageUrl)) {
    return response.status(400).json({ ok: false, error: 'preset_id and a public HTTPS image_url are required' });
  }

  let generationId = null;
  try {
    const trendResponse = await supabase(`trends?preset_id=eq.${encodeURIComponent(presetId)}&status=eq.published&select=id,title,description,video_url,prompt,model_id,media_type,duration_seconds,price,face_required&limit=1`);
    if (!trendResponse.ok) throw new Error(`Preset lookup failed: ${trendResponse.status}`);
    const trends = await trendResponse.json();
    const trend = trends[0];
    if (!trend) return response.status(404).json({ ok: false, error: 'Preset not found or not published' });
    if (!/^https:\/\//i.test(trend.video_url || '') && trend.media_type !== 'image') {
      return response.status(400).json({ ok: false, error: 'Preset has no public reference media' });
    }

    const model = trend.model_id || (trend.media_type === 'image' ? 'image' : 'genjutsu-lite');
    const cost = Math.max(1, Number(trend.price) || (trend.media_type === 'image' ? 15 : trend.duration_seconds <= 8 ? 16 : 23));
    const reserve = await supabase('rpc/reserve_credits', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ p_user_id: user.id, p_amount: cost, p_reference_id: presetId })
    });
    if (!reserve.ok) {
      const text = await reserve.text();
      if (reserve.status === 409) return response.status(402).json({ ok: false, error: 'Not enough credits' });
      throw new Error(`Credit reservation failed: ${reserve.status} ${text}`);
    }

    const created = await supabase('generations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: user.id, trend_id: trend.id, preset_id: presetId, model_id: model, credits_cost: cost, status: 'processing', input_image_url: imageUrl })
    });
    if (!created.ok) throw new Error(`Generation record failed: ${created.status}`);
    const createdRows = await created.json();
    generationId = createdRows[0]?.id || null;

    const provider = await callHiggsfield(model, {
      image_url: imageUrl,
      video_url: trend.video_url,
      prompt: trend.prompt || trend.description || ''
    });

    const providerJobId = provider.data.request_id || provider.data.id || provider.data.job_id || null;
    await supabase(`generations?id=eq.${encodeURIComponent(generationId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'succeeded', provider_job_id: providerJobId, output_video_url: provider.data.video?.url || provider.data.output || null, completed_at: new Date().toISOString() })
    });
    await supabase('rpc/capture_credits', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: user.id, p_amount: cost, p_reference_id: generationId })
    });

    return response.status(200).json({ ok: true, generation_id: generationId, preset_id: presetId, model, credits_used: cost, provider: provider.data });
  } catch (error) {
    console.error('Universal generation failed:', error);
    if (generationId) {
      await supabase(`generations?id=eq.${encodeURIComponent(generationId)}`, { method: 'PATCH', body: JSON.stringify({ status: 'refunded', error_message: error.message.slice(0, 1000), completed_at: new Date().toISOString() }) }).catch(() => {});
      await supabase('rpc/refund_credits', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_reference_id: generationId }) }).catch(() => {});
    }
    return response.status(error.statusCode || 500).json({ ok: false, error: error.message, generation_id: generationId });
  }
};
