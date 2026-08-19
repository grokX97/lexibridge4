export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(500).json({ ok: false, configured: false, error: 'DEEPSEEK_API_KEY_MISSING' });
  try {
    const r = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok: false, configured: true, deepseekStatus: r.status, error: data?.error?.message || 'DEEPSEEK_AUTH_FAILED' });
    const models = Array.isArray(data?.data) ? data.data.map(x => x.id) : [];
    return res.status(200).json({ ok: true, configured: true, preferredModel: models.includes('deepseek-v4-flash') ? 'deepseek-v4-flash' : (models[0] || null), models });
  } catch (e) {
    return res.status(502).json({ ok: false, configured: true, error: 'DEEPSEEK_UNREACHABLE' });
  }
}
