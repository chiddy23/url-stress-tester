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

## Safety

Only test targets you are allowed to hit. The proxy can request arbitrary `http(s)` URLs (SSRF-shaped); keep **`STRESS_PROXY_TOKEN`** strong and rotate if leaked.
