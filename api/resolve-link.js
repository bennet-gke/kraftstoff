/**
 * Vercel-Funktion: GET /api/resolve-link?url=<Kurzlink>
 * Löst Kurzlinks aus Google Maps / Apple Karten zur vollständigen Karten-URL auf.
 */
import { resolveNavigationLink } from './_lib/resolveLink.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Nur GET-Anfragen sind erlaubt.' });
  }
  const url = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url || '';
  try {
    const result = await resolveNavigationLink(url);
    if (!result.success) return res.status(result.status || 400).json({ success: false, error: result.error });
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(200).json({ success: true, finalUrl: result.finalUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: `Link konnte nicht aufgelöst werden: ${err.message}` });
  }
}
