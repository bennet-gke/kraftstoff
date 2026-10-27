/**
 * Vercel-Funktion: GET /api/tankerkoenig
 *  - ?lat=…&lng=…&rad=…&type=all&apikey=…  → Umkreissuche (list.php)
 *  - ?id=<Stations-ID>&apikey=…            → Stationsdetails (detail.php)
 * Optional serverseitiger Key: Umgebungsvariable TANKERKOENIG_API_KEY (siehe README).
 */
import { proxyTankerkoenig } from './_lib/tankerkoenig.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Nur GET-Anfragen sind erlaubt.' });
  }
  const result = await proxyTankerkoenig(req.query || {}, process.env);
  if (result.cacheControl) res.setHeader('Cache-Control', result.cacheControl);
  return res.status(result.status).json(result.body);
}
