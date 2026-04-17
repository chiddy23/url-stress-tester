# URL stress tester

Single-page **browser** load tester (`index.html`) plus optional **Node proxy** (`stress-proxy.mjs`) to hit `http(s)` URLs that do not send CORS headers.

## Run locally

```bash
node stress-proxy.mjs
```

Open `index.html` in a browser, enable **Use proxy**, set **Proxy base** to `http://127.0.0.1:8765` (optional **Proxy token** only if you set `STRESS_PROXY_TOKEN`).

## Deploy proxy on Render

1. Push this repo to GitHub.
2. Render → **New** → **Blueprint** (or Web Service from repo). Use `render.yaml`.
3. In the Render dashboard, set environment variable **`STRESS_PROXY_TOKEN`** to a long random secret.
4. After deploy, copy the service URL (`https://….onrender.com`).
5. Open the UI (local file, or host `index.html` on Vercel/static host). Enable proxy, **Proxy base** = that URL, **Proxy token** = the same secret.

## Host UI on Vercel (optional)

Connect the repo as a **static** project; root `index.html` is served at `/`. The proxy still runs on Render; point **Proxy base** at Render.

## Safety

Use only on targets you are allowed to test. The proxy is an SSRF-capable relay; never expose it without **TLS + `STRESS_PROXY_TOKEN`** on a public URL.
