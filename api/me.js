function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

async function getAuthUser(request) {
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!token || !base || !key) return null;
  const result = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  return result.ok ? result.json() : null;
}

async function read(path) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  return fetch(`${base}/rest/v1/${path}`, { headers: headers(key) });
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const user = await getAuthUser(request);
    if (!user?.id) return response.status(401).json({ ok: false, error: 'Sign in is required' });
    const [profileResponse, accountResponse, generationsResponse] = await Promise.all([
      read(`profiles?id=eq.${user.id}&select=id,display_name,avatar_url,created_at&limit=1`),
      read(`credit_accounts?user_id=eq.${user.id}&select=balance,reserved,updated_at&limit=1`),
      read(`generations?user_id=eq.${user.id}&select=id,preset_id,model_id,credits_cost,status,output_video_url,error_message,created_at,completed_at&order=created_at.desc&limit=20`)
    ]);
    if (!profileResponse.ok || !accountResponse.ok || !generationsResponse.ok) throw new Error('Unable to load account data');
    const profiles = await profileResponse.json();
    const accounts = await accountResponse.json();
    const generations = await generationsResponse.json();
    return response.status(200).json({ ok: true, user: { id: user.id, email: user.email }, profile: profiles[0] || null, credits: accounts[0] || { balance: 0, reserved: 0 }, generations });
  } catch (error) {
    console.error('GET /api/me failed:', error);
    return response.status(500).json({ ok: false, error: 'Unable to load account' });
  }
};
