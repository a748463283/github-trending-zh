#!/usr/bin/env node
/**
 * 本地静态预览服务器（仅用于开发/验收，不参与 Cloudflare Pages 部署）
 *   node scripts/serve.mjs            # http://127.0.0.1:8788
 *   node scripts/serve.mjs --port=9000
 *
 * 只服务 public/ 目录，/api/* 一律返回 404，
 * 因此页面会走「静态快照」路径，正好可以验证兜底逻辑。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');
const portArg = process.argv.slice(2).find((a) => a.startsWith('--port='));
const PORT = Number(portArg ? portArg.split('=')[1] : 8788);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  // 目录路径（/me/）按 index.html 处理，行为与 Cloudflare Pages 一致
  if (pathname.endsWith('/')) pathname += 'index.html';
  else if (pathname === '') pathname = '/index.html';

  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '本地预览不提供 Functions，请使用 npm run dev' }));
    return;
  }

  const target = join(PUBLIC_DIR, normalize(pathname).replace(/^([/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 未找到');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`静态预览已启动： http://127.0.0.1:${PORT}/`);
  console.log('（按 Ctrl+C 结束）');
});
