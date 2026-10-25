export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { lat, lng, rad = 5, sort = 'dist', type = 'all', apikey, id } = req.query || {};

  const userKey = (apikey && apikey.trim() !== '') ? apikey.trim() : (process.env.VITE_TANKERKOENIG_KEY || '').trim();

  // Ohne gültigen persönlichen API-Key keine Abfrage
  if (!userKey || userKey === '00000000-0000-0000-0000-000000000002') {
    return res.status(401).json({
      ok: false,
      needsApiKey: true,
      message: 'Tankerkönig API-Key erforderlich. Bitte trage deinen persönlichen API-Key in den Einstellungen ein.',
    });
  }

  // 1. Detail-Abruf für eine Station (Öffnungszeiten, exakte Adresse)
  if (id) {
    try {
      const detailUrl = `https://creativecommons.tankerkoenig.de/json/detail.php?id=${id}&apikey=${userKey}`;
      const response = await fetch(detailUrl);
      const data = await response.json();
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ ok: false, message: 'Fehler beim Abruf von Tankerkönig Station-Details: ' + err.message });
    }
  }

  // 2. Umkreis-Suche für Tankstellen
  if (!lat || !lng) {
    return res.status(400).json({ ok: false, message: 'Fehlende Koordinaten (lat, lng erforderlich).' });
  }

  const radius = Math.min(Math.max(parseFloat(rad) || 5, 1), 25);
  const targetUrl = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=${radius}&sort=${sort}&type=${type}&apikey=${userKey}`;

  try {
    const response = await fetch(targetUrl);
    const data = await response.json();

    res.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=90');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Fehler beim Abruf von Tankerkönig: ' + err.message });
  }
}
