/**
 * HTTP forwarder for url-stress-tester.html — hits arbitrary http(s) URLs (no browser CORS).
 *
 * Local:
 *   node stress-proxy.mjs
 *
 * Render Web Service:
 *   Use package.json + render.yaml. Set STRESS_PROXY_TOKEN in the dashboard (required on Render).
 *
 * Privacy / lock-down (optional env):
 *   STRESS_PROXY_CORS_ORIGIN     — e.g. https://stress-proxy.onrender.com (omit trailing slash). Locks ACAO instead of *.
 *   STRESS_PROXY_ALLOWED_HOST_SUFFIXES — comma list: .corp.example.com,corp.example.com  (only these hostnames can be forwarded)
 *   STRESS_PROXY_HTTPS_ONLY      — set to 1 or true to reject non-https upstream URLs
 *   STRESS_PROXY_UPSTREAM_UA     — User-Agent for upstream fetch (default InternalLoadTest/1.0)
 *   STRESS_PROXY_SAFE_ERRORS     — set to 1 to hide upstream error text in JSON responses
 *
 * Env: PORT, STRESS_PROXY_PORT, STRESS_PROXY_HOST, STRESS_PROXY_TOKEN, RENDER (auto).
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let indexHtmlCache = null;
function getIndexHtml() {
  if (indexHtmlCache !== null) return indexHtmlCache;
  try {
    indexHtmlCache = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  } catch {
    indexHtmlCache = "";
  }
  return indexHtmlCache;
}

function sendHtml(res, status, body) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.writeHead(status);
  res.end(body);
}

const ON_RENDER = Boolean(process.env.RENDER);
const PORT =
  Number.parseInt(String(process.env.PORT || process.env.STRESS_PROXY_PORT || "8765"), 10) || 8765;
const HOST = (
  process.env.STRESS_PROXY_HOST || (ON_RENDER ? "0.0.0.0" : "127.0.0.1")
).trim() || "127.0.0.1";
const TOKEN = process.env.STRESS_PROXY_TOKEN ? String(process.env.STRESS_PROXY_TOKEN).trim() : "";
const MAX_BODY = 65536;

const CORS_ORIGIN = (process.env.STRESS_PROXY_CORS_ORIGIN || "").trim().replace(/\/+$/, "");
const HOST_SUFFIXES = (process.env.STRESS_PROXY_ALLOWED_HOST_SUFFIXES || "")
  .split(/[,;\n]/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const HTTPS_ONLY =
  process.env.STRESS_PROXY_HTTPS_ONLY === "1" ||
  String(process.env.STRESS_PROXY_HTTPS_ONLY || "").toLowerCase() === "true";
const UPSTREAM_UA = (process.env.STRESS_PROXY_UPSTREAM_UA || "").trim() || "InternalLoadTest/1.0";
const SAFE_ERRORS =
  process.env.STRESS_PROXY_SAFE_ERRORS === "1" ||
  String(process.env.STRESS_PROXY_SAFE_ERRORS || "").toLowerCase() === "true";

if (ON_RENDER && !TOKEN) {
  console.error("Render: set STRESS_PROXY_TOKEN in Environment. Refusing to start without it.");
  process.exit(1);
}

const ALLOW_HEADERS = "Content-Type, Authorization, X-Stress-Proxy-Token";

function applyCors(res) {
  if (CORS_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
}

function json(res, status, obj) {
  applyCors(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

function hostAllowed(hostname) {
  if (!HOST_SUFFIXES.length) return true;
  const h = String(hostname).toLowerCase();
  return HOST_SUFFIXES.some((e) => {
    if (!e) return false;
    if (e.startsWith(".")) return h === e.slice(1) || h.endsWith(e);
    return h === e || h.endsWith("." + e);
  });
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
  if (
    req.method === "GET" &&
    (path === "/health" ||
      path === "/health/" ||
      path === "/" ||
      path === "")
  ) {
    return true;
  }
  if (tokenMatches(TOKEN, getClientToken(req))) return true;
  json(res, 401, { ok: false, error: "unauthorized" });
  return false;
}

const server = http.createServer(async (req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url || "").split("?")[0] || "/";

  if (!requireAuth(req, res, path)) return;

  if (path === "/health" || path === "/health/") {
    if (req.method === "GET") {
      json(res, 200, {
        ok: true,
        service: "stress-proxy",
        port: PORT,
        auth: Boolean(TOKEN),
        hostPolicy: Boolean(HOST_SUFFIXES.length),
        httpsOnly: HTTPS_ONLY,
        corsLocked: Boolean(CORS_ORIGIN),
      });
      return;
    }
    json(res, 405, { ok: false, error: "use GET /health" });
    return;
  }

  if (path === "/" || path === "") {
    if (req.method === "GET") {
      const indexBody = getIndexHtml();
      if (indexBody) {
        sendHtml(res, 200, indexBody);
        return;
      }
      json(res, 200, {
        ok: true,
        service: "stress-proxy",
        port: PORT,
        authRequired: Boolean(TOKEN),
        note: "index.html missing next to stress-proxy.mjs",
        endpoints: {
          "GET /health": "reachability check",
          "POST /forward": 'JSON body: { "url": "https://…", "method": "GET" }',
        },
      });
      return;
    }
    json(res, 405, { ok: false, error: "use GET / for UI" });
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

  if (HTTPS_ONLY && u.protocol !== "https:") {
    json(res, 400, { ok: false, error: "https only" });
    return;
  }

  if (!hostAllowed(u.hostname)) {
    json(res, 403, { ok: false, error: "host not allowed" });
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
      headers: { "User-Agent": UPSTREAM_UA },
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
    const msg = SAFE_ERRORS
      ? "upstream request failed"
      : e && e.message
        ? String(e.message)
        : String(e);
    json(res, 200, { ok: false, error: msg, upstreamMs });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Stress proxy listening on http://${HOST}:${PORT}`);
  if (ON_RENDER) {
    console.log("Render: open the service root URL in a browser for the UI; set Proxy token to STRESS_PROXY_TOKEN for load tests.");
  }
  if (TOKEN) {
    console.log(
      "Auth: Bearer (or X-Stress-Proxy-Token) required for POST /forward. GET / and GET /health are public."
    );
  } else {
    console.warn("Auth: disabled — set STRESS_PROXY_TOKEN if this port is reachable beyond localhost.");
  }
  if (HOST_SUFFIXES.length) {
    console.log("STRESS_PROXY_ALLOWED_HOST_SUFFIXES active (" + HOST_SUFFIXES.length + " entries).");
  }
  if (HTTPS_ONLY) console.log("STRESS_PROXY_HTTPS_ONLY: upstream URLs must use https.");
  if (CORS_ORIGIN) console.log("STRESS_PROXY_CORS_ORIGIN: browser API limited to " + CORS_ORIGIN);
  if (SAFE_ERRORS) console.log("STRESS_PROXY_SAFE_ERRORS: generic upstream error text.");
  if ((HOST === "0.0.0.0" || HOST === "::") && !TOKEN) {
    console.warn("WARNING: wide bind without STRESS_PROXY_TOKEN — SSRF risk.");
  }
  console.log("Ctrl+C to stop.");
});
