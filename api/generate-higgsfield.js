const HIGGSFIELD_ENDPOINT = 'https://api.higgsfield.ai/kling-video/v3/motion-control/pro';

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method === 'GET') {
    return response.status(200).json({
      ok: true,
      provider: 'higgsfield',
      workflow: 'kling-video/v3/motion-control/pro',
      note: 'No generation is started by GET. POST requires confirm="GENERATE".'
    });
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!process.env.HF_CREDENTIALS) {
    return response.status(500).json({ ok: false, error: 'HF_CREDENTIALS is not configured' });
  }

  const body = request.body || {};
  if (body.confirm !== 'GENERATE') {
    return response.status(400).json({
      ok: false,
      error: 'Generation is locked. Send confirm="GENERATE" only when you intentionally want to spend credits.'
    });
  }

  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
  const videoUrl = typeof body.video_url === 'string' ? body.video_url.trim() : '';
  if (!/^https:\/\//i.test(imageUrl) || !/^https:\/\//i.test(videoUrl)) {
    return response.status(400).json({
      ok: false,
      error: 'image_url and video_url must be public HTTPS URLs'
    });
  }

  const input = {
    prompt: typeof body.prompt === 'string' ? body.prompt.slice(0, 1000) : '',
    image_url: imageUrl,
    video_url: videoUrl,
    keep_original_sound: body.keep_original_sound === 'no' ? 'no' : 'yes',
    character_orientation: body.character_orientation === 'image' ? 'image' : 'video'
  };

  try {
    const upstream = await fetch(HIGGSFIELD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.HF_CREDENTIALS}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 2000) };
    }

    return response.status(upstream.status).json({
      ok: upstream.ok,
      provider: 'higgsfield',
      ...data
    });
  } catch (error) {
    console.error('Higgsfield request failed:', error);
    return response.status(502).json({ ok: false, error: 'Unable to reach Higgsfield' });
  }
};
