import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import os from 'os'

function icloudSyncPlugin() {
  const getDefaultPath = () => {
    return path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/kraftstoff_daten.json')
  }

  const resolveUserPath = (inputPath) => {
    if (!inputPath || inputPath.trim() === '') {
      return getDefaultPath()
    }
    let p = inputPath.trim()
    if (p.startsWith('~/')) {
      p = path.join(os.homedir(), p.slice(2))
    }
    return path.resolve(p)
  }

  return {
    name: 'icloud-sync-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlStr = req.url || ''
        if (!urlStr.startsWith('/api/icloud-sync')) {
          return next()
        }

        const parsedUrl = new URL(urlStr, `http://${req.headers.host || 'localhost'}`)
        const queryPath = parsedUrl.searchParams.get('path')

        // GET /api/icloud-sync/check -> Status & Pfad-Informationen
        if (parsedUrl.pathname === '/api/icloud-sync/check') {
          const filePath = resolveUserPath(queryPath)
          const defaultPath = getDefaultPath()
          const exists = fs.existsSync(filePath)
          let stats = null
          if (exists) {
            try {
              const s = fs.statSync(filePath)
              stats = { mtime: s.mtime, size: s.size }
            } catch {}
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            success: true,
            path: filePath,
            defaultPath,
            exists,
            stats
          }))
          return
        }

        // GET /api/icloud-sync -> Datei direkt lesen
        if (req.method === 'GET') {
          const filePath = resolveUserPath(queryPath)
          try {
            if (fs.existsSync(filePath)) {
              const content = fs.readFileSync(filePath, 'utf-8')
              const stats = fs.statSync(filePath)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: true,
                path: filePath,
                lastModified: stats.mtime,
                sizeBytes: stats.size,
                data: JSON.parse(content)
              }))
            } else {
              res.setHeader('Content-Type', 'application/json')
              res.statusCode = 404
              res.end(JSON.stringify({
                success: false,
                error: 'Datei existiert noch nicht an diesem Pfad.',
                path: filePath
              }))
            }
          } catch (err) {
            res.setHeader('Content-Type', 'application/json')
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: err.message, path: filePath }))
          }
          return
        }

        // POST /api/icloud-sync -> Datei direkt schreiben
        if (req.method === 'POST') {
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}')
              const filePath = resolveUserPath(payload.path || queryPath)
              const dir = path.dirname(filePath)
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
              }
              const jsonContent = JSON.stringify(payload.data || {}, null, 2)
              fs.writeFileSync(filePath, jsonContent, 'utf-8')
              const stats = fs.statSync(filePath)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: true,
                path: filePath,
                lastModified: stats.mtime,
                sizeBytes: stats.size
              }))
            } catch (err) {
              res.setHeader('Content-Type', 'application/json')
              res.statusCode = 500
              res.end(JSON.stringify({ success: false, error: err.message }))
            }
          })
          return
        }

        next()
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), icloudSyncPlugin()],
})
