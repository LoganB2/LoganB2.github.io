// Local dev server for previewing the site + API routes without needing a
// Vercel account/login. Serves static files from the project root and
// routes /api/* requests to the same handler files Vercel would use in
// production (api/recommend.js, api/people.js), via a small req/res shim.
//
// Usage: node scripts/dev-server.js  (or via .claude/launch.json preview)

import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const apiHandlers = {
  '/api/recommend': (await import('../api/recommend.js')).default,
  '/api/people': (await import('../api/people.js')).default,
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function makeRes(res) {
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(obj) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    },
    end(body) {
      res.end(body);
    },
  };
}

async function handleApi(req, res, pathname, query) {
  const handler = apiHandlers[pathname];
  const shimRes = makeRes(res);

  let body = {};
  if (req.method === 'POST') {
    const raw = await readBody(req);
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      shimRes.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  try {
    await handler({ method: req.method, query, body }, shimRes);
  } catch (err) {
    console.error(err);
    shimRes.status(500).json({ error: err.message });
  }
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT, decodeURIComponent(filePath));

  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname, query);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
});
