// Static file serving: security headers, gzip/brotli, ETag/Last-Modified revalidation,
// long caching for the versioned three.js files and a per-page Content-Security-Policy.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip), brotli = promisify(zlib.brotliCompress);

export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.txt', '.xml', '.svg', '.bin', '.gltf', '.wasm', '.ico']);

// Headers for every response (pages, API, errors).
export function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  if (String(req.headers['x-forwarded-proto'] || '').startsWith('https')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

const HOST_OK = /^[a-z0-9.-]+(:\d{1,5})?$/i;
function originOf(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = String(req.headers.host || '');
  if (!HOST_OK.test(host)) return '';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function csp(req, scriptHashes) {
  const host = String(req.headers.host || '');
  const ws = HOST_OK.test(host) ? ` wss://${host} ws://${host}` : '';
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHashes.map((h) => ` 'sha256-${h}'`).join('')}`,
    "style-src 'self' 'unsafe-inline'", // style="" attributes are used all over the UI
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self'${ws}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const parseEnc = (h) => {
  const out = new Set();
  for (const part of String(h || '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (params.some((p) => /^\s*q=0(\.0*)?\s*$/.test(p))) continue;
    out.add(name.trim());
  }
  return out;
};

// mounts: [[urlPrefix, dir, { cache, only }]]  cache: 'immutable' | 'revalidate'; only: allowed sub-folders
export function createStatic({ mounts, rewriteHtml = (s) => s }) {
  const cache = new Map(); // key -> entry
  const MAX_ENTRIES = 400;

  function resolve(url) {
    for (const [prefix, dir, opts = {}] of mounts) {
      if (!url.startsWith(prefix)) continue;
      const rel = url.slice(prefix.length);
      if (rel.split('/').some((seg) => seg.startsWith('.'))) return null; // no dotfiles, no ..
      if (opts.only && !opts.only.some((o) => rel.startsWith(o))) return null;
      const file = path.normalize(path.join(dir, rel));
      if (!file.startsWith(dir + path.sep)) return null;
      return { file, opts };
    }
    return null;
  }

  async function load(file, key, st, req) {
    let e = cache.get(key);
    if (e && e.mtimeMs === st.mtimeMs && e.size === st.size) return e;
    const ext = path.extname(file).toLowerCase();
    let body = await fs.promises.readFile(file);
    let scriptHashes = [];
    if (ext === '.html') {
      const html = rewriteHtml(body.toString('utf8'), req);
      body = Buffer.from(html);
      for (const m of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        scriptHashes.push(crypto.createHash('sha256').update(m[1], 'utf8').digest('base64'));
      }
    }
    e = {
      mtimeMs: st.mtimeMs, size: st.size, body, ext, scriptHashes,
      type: TYPES[ext] || 'application/octet-stream',
      etag: `W/"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`,
      lastModified: new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString(),
      enc: {},
    };
    cache.delete(key); cache.set(key, e);
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    return e;
  }

  function encoded(e, enc) {
    if (!e.enc[enc]) {
      e.enc[enc] = (enc === 'br'
        ? brotli(e.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: e.body.length } })
        : gzip(e.body, { level: 9 })).catch(() => null);
    }
    return e.enc[enc];
  }

  // Returns true if it handled the request.
  async function serve(req, res, url) {
    const hit = resolve(url);
    if (!hit) return false;
    const { file, opts } = hit;
    let st;
    try { st = await fs.promises.stat(file); } catch { return false; }
    if (!st.isFile()) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
    const isHtml = path.extname(file).toLowerCase() === '.html';
    const key = isHtml ? `${file}|${originOf(req)}|${req.headers.host || ''}` : file;
    let e;
    try { e = await load(file, key, st, isHtml ? { origin: originOf(req), host: req.headers.host } : null); } catch { return false; }

    const headers = {
      'Content-Type': e.type,
      'Cache-Control': opts.cache === 'immutable' ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: e.etag,
      'Last-Modified': e.lastModified,
      Vary: 'Accept-Encoding',
    };
    if (isHtml) headers['Content-Security-Policy'] = csp(req, e.scriptHashes);
    if (e.type.startsWith('image/')) headers['Cross-Origin-Resource-Policy'] = 'cross-origin'; // share images and icons may be shown by other sites

    const inm = req.headers['if-none-match'];
    const fresh = inm ? inm.split(',').some((t) => t.trim() === e.etag || t.trim() === '*')
      : req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) >= Date.parse(e.lastModified);
    if (fresh) { res.writeHead(304, headers); res.end(); return true; }

    let body = e.body;
    if (COMPRESSIBLE.has(e.ext) && body.length > 1024) {
      const acc = parseEnc(req.headers['accept-encoding']);
      const enc = acc.has('br') ? 'br' : acc.has('gzip') ? 'gzip' : null;
      if (enc) {
        const z = await encoded(e, enc);
        if (z && z.length < body.length) { body = z; headers['Content-Encoding'] = enc; }
      }
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  // compress the big files ahead of time so the first players don't wait
  async function warm(urls) {
    for (const u of urls) {
      const hit = resolve(u);
      if (!hit) continue;
      try {
        const st = await fs.promises.stat(hit.file);
        const e = await load(hit.file, hit.file, st, null);
        if (COMPRESSIBLE.has(e.ext)) { await encoded(e, 'br'); await encoded(e, 'gzip'); }
      } catch { /* missing file: fine */ }
    }
  }

  return { serve, warm };
}
