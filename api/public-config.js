module.exports = async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ ok: false, error: 'Method not allowed' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response.status(500).json({ ok: false, error: 'Supabase public configuration is not configured' });
  response.setHeader('Cache-Control', 'public, max-age=300');
  return response.status(200).json({ ok: true, supabaseUrl: url, supabasePublishableKey: key });
};
