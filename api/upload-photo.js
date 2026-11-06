const crypto = require('crypto');

async function getUser(request) {
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !base || !key) return null;
  const result = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  return result.ok ? result.json() : null;
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await getUser(request);
    if (!user?.id) return response.status(401).json({ ok: false, error: 'Sign in is required' });
    const body = request.body || {};
    const dataUrl = typeof body.data_url === 'string' ? body.data_url : '';
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return response.status(400).json({ ok: false, error: 'Use a JPEG, PNG or WEBP image' });
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return response.status(413).json({ ok: false, error: 'Photo must be smaller than 8 MB' });
    const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!base || !secret) return response.status(500).json({ ok: false, error: 'Storage server variables are not configured' });
    const ext = match[1].toLowerCase() === 'image/png' ? 'png' : match[1].toLowerCase() === 'image/webp' ? 'webp' : 'jpg';
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const upload = await fetch(`${base}/storage/v1/object/user-photos/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, apikey: secret, 'Content-Type': match[1], 'x-upsert': 'false' },
      body: buffer
    });
    if (!upload.ok) return response.status(502).json({ ok: false, error: `Photo upload failed: ${await upload.text()}` });
    const signed = await fetch(`${base}/storage/v1/object/sign/user-photos/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, apikey: secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 })
    });
    if (!signed.ok) return response.status(502).json({ ok: false, error: 'Could not create temporary photo URL' });
    const signedBody = await signed.json();
    const signedPath = signedBody.signedURL || signedBody.signedUrl;
    const publicUrl = signedPath ? new URL(signedPath, `${base}/`).toString() : null;
    return response.status(200).json({ ok: true, path, url: publicUrl });
  } catch (error) {
    console.error('POST /api/upload-photo failed:', error);
    return response.status(500).json({ ok: false, error: 'Unable to upload photo' });
  }
};
