import react from '@vitejs/plugin-react'
import { resolveNavigationLink } from './api/_lib/resolveLink.js'
import { proxyTankerkoenig } from './api/_lib/tankerkoenig.js'
import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import os from 'os'

function icloudSyncPlugin() {
  // Datenbank-Ordner: Jedes Speichern legt eine neue Datei "kraftstoff_daten_<Zeitstempel>.json" ab,
  // beim Laden wird die neueste gültige Datei gelesen. Der Ordner wird in der App festgelegt.
  // Nur für die lokale Entwicklung (`npm run dev` / `npm run preview`) – auf Vercel gibt es diesen Endpunkt nicht.
  const HOME = os.homedir()
  const DEFAULT_DIR = path.join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs/KRAFTSTOFF')
  const WORKSPACE_PATH = path.join(process.cwd(), 'kraftstoff_daten.json')
  // Auch von iCloud/Finder umbenannte Kopien ("… 2.json", "… (1).json") werden erkannt
  const SNAPSHOT_RE = /^kraftstoff_daten(_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})?( ?\(?\d{1,3}\)?)?\.json$/i
  const TIMESTAMPED_RE = /^kraftstoff_daten_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/i
  const KEEP_NEWEST = 20
  const KEEP_DAILY_DAYS = 14
  const MAX_BODY_BYTES = 40 * 1024 * 1024

  // Ordnerpfad auflösen: "~" -> Benutzerordner, .json-Pfade -> ihr Ordner, nur innerhalb des Benutzerordners
  const resolveDir = (raw) => {
    const input = String(raw || '').trim()
    if (!input) return { ok: true, dir: DEFAULT_DIR }
    let p = input
    if (p === '~' || p.startsWith('~/')) p = path.join(HOME, p.slice(1))
    if (!path.isAbsolute(p)) p = path.join(HOME, p)
    p = path.normalize(p)
    if (p.toLowerCase().endsWith('.json')) p = path.dirname(p)
    const rel = path.relative(HOME, p)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, error: 'Aus Sicherheitsgründen sind nur Ordner innerhalb deines Benutzerordners erlaubt.' }
    }
    return { ok: true, dir: p }
  }

  // Zeitstempel aus dem Dateianfang lesen ("exportedAt" steht vorne in jeder Datei), sonst aus Name/Änderungsdatum
  const readExportedAt = (filePath) => {
    try {
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(400)
      const n = fs.readSync(fd, buf, 0, 400, 0)
      fs.closeSync(fd)
      const m = /"exportedAt"\s*:\s*"([^"]+)"/.exec(buf.toString('utf8', 0, n))
      const t = m ? Date.parse(m[1]) : NaN
      return Number.isFinite(t) ? t : null
    } catch {
      return null
    }
  }

  const nameTime = (name) => {
    const m = /_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(name)
    if (!m) return null
    const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
    return Number.isFinite(t) ? t : null
  }

  const listSnapshots = (dir) => {
    let names = []
    try { names = fs.readdirSync(dir) } catch { return [] }
    const files = []
    for (const name of names) {
      if (!SNAPSHOT_RE.test(name)) continue
      try {
        const full = path.join(dir, name)
        const st = fs.statSync(full)
        if (!st.isFile()) continue
        const at = readExportedAt(full) ?? nameTime(name) ?? st.mtimeMs
        files.push({ name, path: full, mtime: st.mtime, size: st.size, at })
      } catch {}
    }
    files.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1))
    return files
  }

  // Ältere Datei aus der Vorgängerversion (ohne Zeitstempel im Ordner darüber) als Startpunkt
  const findLegacyFile = (dir) => {
    const candidate = path.join(path.dirname(dir), 'kraftstoff_daten.json')
    try {
      const st = fs.statSync(candidate)
      if (st.isFile()) return { name: 'kraftstoff_daten.json', path: candidate, mtime: st.mtime, size: st.size, at: readExportedAt(candidate) ?? st.mtimeMs, legacy: true }
    } catch {}
    return null
  }

  const readSnapshot = (file) => {
    try {
      const content = fs.readFileSync(file.path, 'utf-8')
      const parsed = content.trim() ? JSON.parse(content) : null
      return parsed && typeof parsed === 'object' && parsed.appName === 'KRAFTSTOFF' ? parsed : null
    } catch {
      return null
    }
  }

  const makeSnapshotName = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0')
    return `kraftstoff_daten_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.json`
  }

  // Lesbar, aber kompakt: große Teile (Historie, KI-Modell, Routen-Linien) ohne Einrückung
  const serializeSnapshot = (data) => {
    const heavy = new Set(['priceHistory', 'mlModel', 'routes'])
    const lines = Object.entries(data || {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${heavy.has(k) ? JSON.stringify(v) : JSON.stringify(v, null, 2).replace(/\n/g, '\n  ')}`)
    return `{\n${lines.join(',\n')}\n}\n`
  }

  // Aufräumen: die neuesten 20 Stände plus je Tag den letzten Stand der vergangenen 14 Tage behalten
  const pruneSnapshots = (dir) => {
    const files = listSnapshots(dir).filter((f) => TIMESTAMPED_RE.test(f.name))
    const keep = new Set(files.slice(0, KEEP_NEWEST).map((f) => f.name))
    const seenDays = new Set()
    const minAt = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000
    for (const f of files) {
      if (f.at < minAt) continue
      const day = new Date(f.at).toDateString()
      if (!seenDays.has(day)) {
        seenDays.add(day)
        keep.add(f.name)
      }
    }
    const removed = []
    for (const f of files) {
      if (keep.has(f.name)) continue
      try { fs.unlinkSync(f.path); removed.push(f.name) } catch {}
    }
    return { removed, kept: files.length - removed.length }
  }

  const sendJson = (res, status, obj) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(obj))
  }

  // Nur Anfragen der eigenen App zulassen (keine fremden Webseiten über den Browser)
  const isSameOrigin = (req) => {
    const site = req.headers['sec-fetch-site']
    if (site && site !== 'same-origin' && site !== 'none') return false
    const origin = req.headers.origin
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return false
      } catch {
        return false
      }
    }
    return true
  }

  const fileInfo = (f) => (f ? { name: f.name, mtime: f.mtime, size: f.size, exportedAt: new Date(f.at).toISOString() } : null)

  const handler = (req, res, next) => {
    const urlStr = req.url || ''
    if (!urlStr.startsWith('/api/icloud-sync')) {
      return next()
    }
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { success: false, error: 'Nicht erlaubt.' })
      return
    }

    const parsedUrl = new URL(urlStr, `http://${req.headers.host || 'localhost'}`)
    const dirParam = parsedUrl.searchParams.get('dir') || parsedUrl.searchParams.get('path')

    // GET /api/icloud-sync/check?dir=... -> Erreichbarkeit, Ordnerstatus, vorhandene Dateien
    if (parsedUrl.pathname === '/api/icloud-sync/check') {
      const resolved = resolveDir(dirParam)
      if (!resolved.ok) {
        sendJson(res, 200, { success: true, isAvailable: true, pathOk: false, error: resolved.error, defaultDir: DEFAULT_DIR, homeDir: HOME })
        return
      }
      let dirExists = false
      try { dirExists = fs.statSync(resolved.dir).isDirectory() } catch {}
      const files = dirExists ? listSnapshots(resolved.dir) : []
      const legacy = files.length === 0 ? findLegacyFile(resolved.dir) : null
      sendJson(res, 200, {
        success: true,
        isAvailable: true,
        pathOk: true,
        dir: resolved.dir,
        defaultDir: DEFAULT_DIR,
        homeDir: HOME,
        dirExists,
        inICloud: resolved.dir.includes(`${path.sep}Mobile Documents${path.sep}com~apple~CloudDocs`),
        fileCount: files.length,
        files: files.slice(0, 10).map(fileInfo),
        newest: fileInfo(files[0]),
        legacy: legacy ? { ...fileInfo(legacy), path: legacy.path } : null,
      })
      return
    }

    // GET /api/icloud-sync?dir=... -> neueste gültige Datei lesen (leere/kaputte Dateien werden übersprungen)
    if (req.method === 'GET') {
      const resolved = resolveDir(dirParam)
      if (!resolved.ok) {
        sendJson(res, 400, { success: false, error: resolved.error })
        return
      }
      const files = listSnapshots(resolved.dir)
      const candidates = files.length > 0 ? files : [findLegacyFile(resolved.dir)].filter(Boolean)
      if (candidates.length === 0) {
        sendJson(res, 200, { success: true, exists: false, dir: resolved.dir, data: null, fileCount: 0 })
        return
      }
      const skipped = []
      for (const target of candidates) {
        const data = readSnapshot(target)
        if (!data) {
          skipped.push(target.name)
          continue
        }
        sendJson(res, 200, {
          success: true,
          exists: true,
          dir: resolved.dir,
          name: target.name,
          path: target.path,
          legacy: !!target.legacy,
          lastModified: target.mtime,
          exportedAt: new Date(target.at).toISOString(),
          sizeBytes: target.size,
          fileCount: files.length,
          skipped,
          data,
        })
        return
      }
      sendJson(res, 422, { success: false, error: `Keine lesbare KRAFTSTOFF-Datei im Ordner (${skipped.length} beschädigt oder leer).`, skipped })
      return
    }

    // POST /api/icloud-sync { dir, data } -> neue Datei mit Zeitstempel schreiben, alte Stände aufräumen
    if (req.method === 'POST') {
      if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) {
        sendJson(res, 415, { success: false, error: 'Nur JSON wird angenommen.' })
        return
      }
      const chunks = []
      let size = 0
      let aborted = false
      req.on('data', (chunk) => {
        if (aborted) return
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          aborted = true
          sendJson(res, 413, { success: false, error: 'Datei zu groß.' })
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (aborted) return
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          const data = payload && payload.data
          if (!data || typeof data !== 'object' || data.appName !== 'KRAFTSTOFF') {
            sendJson(res, 400, { success: false, error: 'Ungültige Datenbank-Daten.' })
            return
          }
          const resolved = resolveDir(payload.dir || payload.path || dirParam)
          if (!resolved.ok) {
            sendJson(res, 400, { success: false, error: resolved.error })
            return
          }
          const dir = resolved.dir
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

          const content = serializeSnapshot(data)
          // Nie eine vorhandene Datei überschreiben: bei gleicher Sekunde eine Sekunde weiterzählen
          let when = new Date()
          let name = makeSnapshotName(when)
          let filePath = path.join(dir, name)
          for (let attempt = 0; attempt < 10; attempt++) {
            try {
              fs.writeFileSync(filePath, content, { encoding: 'utf-8', flag: 'wx' })
              break
            } catch (e) {
              if (e.code !== 'EEXIST' || attempt === 9) throw e
              when = new Date(when.getTime() + 1000)
              name = makeSnapshotName(when)
              filePath = path.join(dir, name)
            }
          }
          const st = fs.statSync(filePath)
          const { removed, kept } = pruneSnapshots(dir)

          // Zusätzliche Workspace-Kopie (Redundanz, nicht im Git)
          try { fs.writeFileSync(WORKSPACE_PATH, content, 'utf-8') } catch (e) { console.warn('Workspace-Kopie:', e.message) }

          sendJson(res, 200, {
            success: true,
            dir,
            name,
            path: filePath,
            savedToIcloud: filePath.includes('Mobile Documents'),
            lastModified: st.mtime,
            sizeBytes: st.size,
            kept,
            removed,
          })
        } catch (err) {
          sendJson(res, 500, { success: false, error: err.message })
        }
      })
      return
    }

    sendJson(res, 405, { success: false, error: 'Methode nicht erlaubt.' })
  }

  return {
    name: 'icloud-sync-plugin',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    }
  }
}

function sendJsonResponse(res, status, body, cacheControl) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (cacheControl) res.setHeader('Cache-Control', cacheControl)
  res.end(JSON.stringify(body))
}

// Tankerkönig-Proxy für Entwicklung und `vite preview` (gleiche Logik wie api/tankerkoenig.js auf Vercel)
function tankerkoenigPlugin() {
  const handler = async (req, res, next) => {
    const urlStr = req.url || ''
    if (!urlStr.startsWith('/api/tankerkoenig')) return next()
    if (req.method !== 'GET') return sendJsonResponse(res, 405, { ok: false, message: 'Nur GET-Anfragen sind erlaubt.' })
    const parsedUrl = new URL(urlStr, `http://${req.headers.host || 'localhost'}`)
    const result = await proxyTankerkoenig(Object.fromEntries(parsedUrl.searchParams), process.env)
    sendJsonResponse(res, result.status, result.body, result.cacheControl)
  }
  return {
    name: 'tankerkoenig-plugin',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    }
  }
}

// Kurzlinks aus Google Maps / Apple Karten auflösen (gleiche Logik wie api/resolve-link.js auf Vercel)
function linkResolverPlugin() {
  const handler = async (req, res, next) => {
    const urlStr = req.url || ''
    if (!urlStr.startsWith('/api/resolve-link')) return next()
    const parsedUrl = new URL(urlStr, `http://${req.headers.host || 'localhost'}`)
    try {
      const result = await resolveNavigationLink(parsedUrl.searchParams.get('url') || '')
      if (result.success) sendJsonResponse(res, 200, { success: true, finalUrl: result.finalUrl })
      else sendJsonResponse(res, result.status || 400, { success: false, error: result.error })
    } catch (e) {
      sendJsonResponse(res, 500, { success: false, error: `Link konnte nicht aufgelöst werden: ${e.message}` })
    }
  }
  return {
    name: 'link-resolver-plugin',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    }
  }
}

// Service Worker: Build-ID und Liste aller Build-Dateien eintragen (Offline-Start, sauberes Update je Deployment)
function serviceWorkerBuildPlugin() {
  let outDir = 'dist'
  const walk = (dir, base = '') => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue
      const rel = base ? `${base}/${entry.name}` : entry.name
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full, rel))
      else out.push(rel)
    }
    return out
  }
  return {
    name: 'kraftstoff-sw-build',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const swPath = path.join(outDir, 'sw.js')
      if (!fs.existsSync(swPath)) return
      const files = walk(outDir)
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && f !== 'index.html')
        // Schriften: nur WOFF2 für Latein vorab laden, alles andere bei Bedarf
        .filter((f) => !/\.woff2?$/.test(f) || /-latin(-ext)?-\d{3}-normal-[^/]+\.woff2$/.test(f))
        .map((f) => `/${f.split(path.sep).join('/')}`)
      const buildId = `${Date.now().toString(36)}-${files.filter((f) => f.startsWith('/assets/')).length}`
      const src = fs.readFileSync(swPath, 'utf-8')
        .replace("'__KRAFTSTOFF_BUILD_ID__'", JSON.stringify(buildId))
        .replace('[] /*__KRAFTSTOFF_PRECACHE__*/', JSON.stringify(files))
      fs.writeFileSync(swPath, src)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true, // Erreichbar im gesamten Heimnetzwerk (für iPhone & Mac)
  },
  preview: {
    host: true,
  },
  build: {
    // TensorFlow.js (~1 MB) wird erst bei Bedarf nachgeladen und blockiert den Start nicht
    chunkSizeWarningLimit: 1200,
  },
  plugins: [react(), icloudSyncPlugin(), tankerkoenigPlugin(), linkResolverPlugin(), serviceWorkerBuildPlugin()],
})
