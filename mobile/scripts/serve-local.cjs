const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const policy = require('../security/web-policy.json');
const MIME = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.task':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
function createLocalServer(directory) {
  const root = fs.realpathSync(directory);
  return http.createServer((req, res) => {
    const expected = ['127.0.0.1:' + res.socket.localPort, 'localhost:' + res.socket.localPort];
    res.setHeader('Content-Security-Policy', policy.contentSecurityPolicy + "; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    if (!expected.includes(req.headers.host) || (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)) { res.writeHead(403); res.end(); return; }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {'Allow':'GET, HEAD'}); res.end(); return; }
    try {
      const raw = decodeURIComponent(req.url.split('?')[0]);
      if (raw.includes('\\') || raw.includes('\0') || raw.split('/').includes('..')) { res.writeHead(400); res.end(); return; }
      let requested = path.resolve(root, '.' + (raw === '/' ? '/index.html' : raw));
      if (!fs.existsSync(requested) && !path.extname(requested)) requested += '.html';
      const file = fs.realpathSync(requested);
      if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) { res.writeHead(403); res.end(); return; }
      res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch { res.writeHead(404); res.end(); }
  });
}
module.exports = { createLocalServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida');
  createLocalServer(path.resolve(__dirname, '../dist')).listen(port, '127.0.0.1', () => console.log('RepCounter local: http://127.0.0.1:' + port));
}
