module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const credentials = process.env.HF_CREDENTIALS || '';
  const separator = credentials.indexOf(':');
  const hasId = separator > 0;
  const hasSecret = separator > 0 && credentials.length > separator + 1;

  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({
    ok: hasId && hasSecret,
    provider: 'higgsfield',
    credentialsConfigured: hasId && hasSecret,
    note: 'This diagnostic does not call Higgsfield and does not spend credits.'
  });
};
