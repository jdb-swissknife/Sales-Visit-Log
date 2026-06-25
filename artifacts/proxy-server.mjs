/**
 * Lightweight static + proxy server for Sales-Visit-Log production.
 *
 *   - Serves the built frontend (dist/public) on PORT (8097)
 *   - Proxies /api/* to the backend API server (8090)
 *   - Falls back to index.html for client-side routes
 */
import { createServer, request as httpRequest } from "http";
import { readFile, stat } from "fs/promises";
import { extname, join, normalize } from "path";

const PORT = Number(process.env.PORT ?? 8097);
const API_TARGET = new URL(process.env.API_TARGET ?? "http://localhost:8090");
const STATIC_DIR = join(
  process.cwd(),
  "artifacts/sales-outreach/dist/public",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

const indexHtml = await readFile(join(STATIC_DIR, "index.html"));

function proxyToApi(req, res) {
  const opts = {
    hostname: API_TARGET.hostname,
    port: API_TARGET.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: API_TARGET.host },
  };
  const proxyReq = httpRequest(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err.message);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Backend unavailable" }));
  });
  req.pipe(proxyReq);
}

const server = createServer(async (req, res) => {
  // Proxy API calls to the backend
  if (req.url?.startsWith("/api")) {
    proxyToApi(req, res);
    return;
  }

  // Serve static files
  let urlPath = req.url?.split("?")[0] ?? "/";
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = normalize(join(STATIC_DIR, urlPath));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isFile()) {
      const data = await readFile(filePath);
      const mime = MIME[extname(filePath)] ?? "application/octet-stream";
      const cacheControl = extname(filePath) === ".html" ? "no-cache" : "public, max-age=86400";
      res.writeHead(200, { "content-type": mime, "cache-control": cacheControl });
      res.end(data);
      return;
    }
  } catch {
    // File doesn't exist
  }

  // SPA fallback
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  res.end(indexHtml);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SVL frontend on :${PORT}, API proxy -> ${API_TARGET.href}`);
});