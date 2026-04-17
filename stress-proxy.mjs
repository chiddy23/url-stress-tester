/**
 * HTTP forwarder for url-stress-tester.html — hits arbitrary http(s) URLs (no browser CORS).
 *
 * Local:
 *   node stress-proxy.mjs
 *
 * Render Web Service:
 *   Use package.json + render.yaml (or manual Web Service). Set STRESS_PROXY_TOKEN in the dashboard (required).
 *   Render sets PORT; this process listens on that port. Bind defaults to 0.0.0.0 when RENDER=true.
 *   GET /health has no token (platform health checks); POST /forward still requires Bearer token.
 *
 * Vercel:
 *   Deploy only the static HTML, or skip Vercel for the proxy — serverless is a poor fit (timeouts, cost, abuse).
 *   Point “Proxy base” in the HTML at your Render URL.
 *
 * Env: PORT (Render), STRESS_PROXY_PORT (fallback), STRESS_PROXY_HOST, STRESS_PROXY_TOKEN, RENDER (auto).
 */
import http from "node:http";
import crypto from "node:crypto";

const ON_RENDER = Boolean(process.env.RENDER);
const PORT =
  Number.parseInt(String(process.env.PORT || process.env.STRESS_PROXY_PORT || "8765"), 10) || 8765;
const HOST = (
  process.env.STRESS_PROXY_HOST || (ON_RENDER ? "0.0.0.0" : "127.0.0.1")
).trim() || "127.0.0.1";
const TOKEN = process.env.STRESS_PROXY_TOKEN ? String(process.env.STRESS_PROXY_TOKEN).trim() : "";
const MAX_BODY = 65536;

if (ON_RENDER && !TOKEN) {
  console.error("Render: set STRESS_PROXY_TOKEN in Environment. Refusing to start without it.");
  process.exit(1);
}

const ALLOW_HEADERS = "Content-Type, Authorization, X-Stress-Proxy-Token";

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
}

function json(res, status, obj) {
  setCORS(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

function getClientToken(req) {
  const x = req.headers["x-stress-proxy-token"];
  if (typeof x === "string" && x.trim()) return x.trim();
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function tokenMatches(expected, provided) {
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided || "", "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function requireAuth(req, res, path) {
  if (!TOKEN) return true;
  if (req.method === "GET" && (path === "/health" || path === "/health/")) {
    return true;
  }
  if (tokenMatches(TOKEN, getClientToken(req))) return true;
  json(res, 401, { ok: false, error: "unauthorized" });
  return false;
}

const server = http.createServer(async (req, res) => {
  setCORS(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url || "").split("?")[0] || "/";

  if (!requireAuth(req, res, path)) return;

  if (path === "/health" || path === "/health/") {
    if (req.method === "GET") {
      json(res, 200, { ok: true, service: "stress-proxy", port: PORT, auth: Boolean(TOKEN) });
      return;
    }
    json(res, 405, { ok: false, error: "use GET /health" });
    return;
  }

  if (path === "/" || path === "") {
    if (req.method === "GET") {
      json(res, 200, {
        ok: true,
        service: "stress-proxy",
        port: PORT,
        authRequired: Boolean(TOKEN),
        endpoints: {
          "GET /health": "reachability check",
          "POST /forward": 'JSON body: { "url": "https://…", "method": "GET" }',
        },
      });
      return;
    }
    json(res, 405, { ok: false, error: "use GET / for info" });
    return;
  }

  if (path !== "/forward" && path !== "/forward/") {
    json(res, 404, { ok: false, error: "unknown path — try GET /health or POST /forward" });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "use POST" });
    return;
  }

  let buf = "";
  try {
    for await (const chunk of req) {
      buf += chunk;
      if (buf.length > MAX_BODY) {
        json(res, 413, { ok: false, error: "body too large" });
        return;
      }
    }
  } catch {
    json(res, 400, { ok: false, error: "read body failed" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(buf || "{}");
  } catch {
    json(res, 400, { ok: false, error: "invalid JSON" });
    return;
  }

  const targetUrl = typeof payload.url === "string" ? payload.url.trim() : "";
  const method = (typeof payload.method === "string" ? payload.method : "GET").trim().toUpperCase() || "GET";

  let u;
  try {
    u = new URL(targetUrl);
  } catch {
    json(res, 400, { ok: false, error: "invalid url" });
    return;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    json(res, 400, { ok: false, error: "only http and https URLs" });
    return;
  }

  const t0 = Date.now();
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 120000);
  try {
    const r = await fetch(targetUrl, {
      method,
      redirect: "manual",
      signal: ac.signal,
    });
    if (r.body) {
      try {
        for await (const _ of r.body) {
          /* discard */
        }
      } catch {
        /* ignore drain errors */
      }
    }
    clearTimeout(to);
    const upstreamMs = Date.now() - t0;
    json(res, 200, { ok: true, status: r.status, upstreamMs });
  } catch (e) {
    clearTimeout(to);
    const upstreamMs = Date.now() - t0;
    const msg = e && e.message ? String(e.message) : String(e);
    json(res, 200, { ok: false, error: msg, upstreamMs });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Stress proxy listening on http://${HOST}:${PORT}`);
  if (ON_RENDER) console.log("Render: use your service HTTPS URL as Proxy base in the HTML; set Proxy token to STRESS_PROXY_TOKEN.");
  if (TOKEN) {
    console.log("Auth: Bearer (or X-Stress-Proxy-Token) required for /forward and GET /. GET /health is public.");
  } else {
    console.warn("Auth: disabled — set STRESS_PROXY_TOKEN if this port is reachable beyond localhost.");
  }
  if ((HOST === "0.0.0.0" || HOST === "::") && !TOKEN) {
    console.warn("WARNING: wide bind without STRESS_PROXY_TOKEN — SSRF risk.");
  }
  console.log("POST /forward  body: {\"url\":\"https://…\",\"method\":\"GET\"}");
  console.log("Ctrl+C to stop.");
});
