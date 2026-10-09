/**
 * Static file server for the e2e suites: the `webServer` of playwright.config.js.
 *
 * openMap (helpers.js) serves the app's files to the page from disk, so in the
 * suite this only answers Playwright's port probe and anything a test might
 * fetch outside a routed page. It replaced `python -m http.server` for that
 * job: one runtime on every platform, no request log flooding the run output,
 * and keep-alive. Python spoke HTTP/1.0, a fresh loopback connection per
 * request, which is what Chromium on Windows now and then fails to open (see
 * openMap); reusing connections means fewer chances, not none.
 *
 * Run: node tests/e2e/static-server.js [port]     (default 8788, binds 127.0.0.1)
 *
 * Failed and aborted requests are always logged to stderr, which Playwright
 * prints as [WebServer] lines; STATIC_SERVER_LOG=1 logs every request.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const PORT = Number(process.argv[2] ?? 8788);
const LOG_ALL = process.env.STATIC_SERVER_LOG === '1';

// A module script served with any other type is refused by the browser.
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
};

async function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    let urlPath;
    try {
        urlPath = decodeURIComponent(req.url.split('?')[0]);
    } catch {
        res.writeHead(400).end();
        return;
    }
    // No dot segments: that refuses `..` escapes and dotfiles (.env, .git) alike.
    if (urlPath.split(/[\\/]/).some((segment) => segment.startsWith('.'))) {
        res.writeHead(404).end();
        return;
    }
    let file = join(ROOT, urlPath);
    if (!file.startsWith(ROOT + sep) && file !== ROOT) {
        res.writeHead(404).end();
        return;
    }
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
        if (!urlPath.endsWith('/')) {
            res.writeHead(301, { Location: `${req.url.split('?')[0]}/` }).end();
            return;
        }
        file = join(file, 'index.html');
        info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) {
        res.writeHead(404).end();
        return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer((req, res) => {
    // Keep-alive stays on (Node's default), see the header. No caching, so
    // every test context gets the bytes on disk.
    res.setHeader('Cache-Control', 'no-store');
    res.on('close', () => {
        const outcome = res.writableFinished ? res.statusCode : 'aborted';
        if (LOG_ALL || outcome === 'aborted' || outcome >= 400) {
            console.error(`${outcome} ${req.method} ${req.url}`);
        }
    });
    serve(req, res).catch((err) => {
        console.error(`${req.method} ${req.url}: ${err.message}`);
        if (!res.headersSent) res.writeHead(500);
        res.end();
    });
});

server.listen(PORT, '127.0.0.1');
