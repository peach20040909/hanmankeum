// 로컬 개발·테스트용 서버. API는 handler.js를 그대로 쓰고, 정적 파일만 여기서 서빙한다.
// (Vercel에서는 public/이 정적으로 서빙되고 /api/*는 api/index.js 함수가 받는다.)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handle } from './handler.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await handle(new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const name = ['/app.js', '/style.css'].includes(url.pathname) ? url.pathname : '/index.html';
    res.writeHead(200, { 'Content-Type': MIME[name.slice(name.lastIndexOf('.'))], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(await readFile(new URL(`./public${name}`, import.meta.url)));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '서버 오류가 발생했습니다.' }));
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`한만큼 → http://localhost:${port}`));
