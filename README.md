# URL stress tester

Browser **UI** (`index.html`) plus **Node proxy** (`stress-proxy.mjs`). On **Render**, the same Web Service serves **both**: open your `https://….onrender.com/` in a browser for the tester; it talks to **`POST /forward`** on the same host.

## Run locally

```bash
node stress-proxy.mjs
```

Then open **`http://127.0.0.1:8765/`** in a browser (or open `index.html` as a file and set Proxy base to `http://127.0.0.1:8765`). Optional **Proxy token** only if you set `STRESS_PROXY_TOKEN`.

## Deploy on Render

1. Push this repo to GitHub.
2. Render → **New** → **Blueprint** (or Web Service). Use **`render.yaml`**.
3. Dashboard → **Environment** → set **`STRESS_PROXY_TOKEN`** to a long random secret (required on Render).
4. After **Deploy live**, open the service URL root **`https://<name>.onrender.com/`** — you should see the UI, not raw JSON.
5. **Use proxy** should be on with **Proxy base** = that same origin (auto on `*.onrender.com`). **Proxy token** = the same value as `STRESS_PROXY_TOKEN`.

**Health check:** `GET /health` (no token). **Load:** `POST /forward` (Bearer token required when `STRESS_PROXY_TOKEN` is set).

## Privacy / company-only lock-down (optional)

Set these on the **Render** service (or local env) — they reduce blast radius and fingerprinting; they are **not** a VPN.

| Variable | Purpose |
|----------|---------|
| `STRESS_PROXY_ALLOWED_HOST_SUFFIXES` | Comma list, e.g. `.tools.mycompany.com,mycompany.com` — **only** matching hostnames can be forwarded (403 otherwise). |
| `STRESS_PROXY_HTTPS_ONLY` | `1` or `true` — reject `http://` upstream URLs. |
| `STRESS_PROXY_CORS_ORIGIN` | Your UI origin only, e.g. `https://stress-proxy.onrender.com` — replaces `Access-Control-Allow-Origin: *`. Use when the UI is always on that origin; a **local `file://` UI cannot call** a proxy locked to an `https` origin. |
| `STRESS_PROXY_UPSTREAM_UA` | Custom `User-Agent` on outbound requests (default `InternalLoadTest/1.0`). |
| `STRESS_PROXY_SAFE_ERRORS` | `1` — generic text for upstream failures in JSON (less detail in responses). |

In the **browser UI**, enable **“Redact full URLs in the activity log”** so the on-screen log shows `https://host/…` instead of full paths and query strings (the target URL field is unchanged; only log lines are redacted).

## Safety

Only test targets you are allowed to hit. The proxy can request arbitrary `http(s)` URLs unless **`STRESS_PROXY_ALLOWED_HOST_SUFFIXES`** is set. Keep **`STRESS_PROXY_TOKEN`** strong and rotate if leaked.
