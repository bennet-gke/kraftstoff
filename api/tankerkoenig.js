export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { lat, lng, rad = 5, sort = 'dist', type = 'all', apikey } = req.query || {};

  if (!lat || !lng) {
    return res.status(400).json({ ok: false, message: 'Fehlende Koordinaten (lat, lng erforderlich).' });
  }

  // Verwende hinterlegten User-Key, Environment Key oder offiziellen MTS-K Demo-Key
  const validKey = (apikey && apikey.trim() !== '')
    ? apikey.trim()
    : (process.env.VITE_TANKERKOENIG_KEY || '00000000-0000-0000-0000-000000000002');

  const radius = Math.min(Math.max(parseFloat(rad) || 5, 1), 25);
  const targetUrl = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=${radius}&sort=${sort}&type=${type}&apikey=${validKey}`;

  try {
    const response = await fetch(targetUrl);
    const data = await response.json();

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Fehler beim Abruf von Tankerkönig: ' + err.message });
  }
}
