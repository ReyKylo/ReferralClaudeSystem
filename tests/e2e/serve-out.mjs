// Serves the static export in out/ the way Cloudflare Workers static assets do (html_handling auto-trailing-slash,
// not_found_handling 404-page), so the e2e tests run against exactly what gets deployed.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'out');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const isFile = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };
const port = Number(process.env.PORT ?? 3200);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, path);
  if (path.endsWith('/')) file = join(file, 'index.html');
  else if (!(await isFile(file)) && (await isFile(join(file, 'index.html')))) { res.writeHead(307, { location: path + '/' + url.search }); return res.end(); }
  if (!(await isFile(file))) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end(await readFile(join(ROOT, '404.html'))); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(port, '127.0.0.1', () => console.log(`out/ on http://127.0.0.1:${port}`));
