# Trebesin 3D

Interactive portfolio for school and personal projects. The planned experience uses camera-based hand tracking to interact with a Three.js scene.

The React app streams opt-in camera capture to FastAPI through a local Vite proxy. CVService authenticates the requests, validates JPEG frames, and returns receipts. Inference, gestures, and 3D rendering are subsequent features. See [AGENTS.md](AGENTS.md) for requirements and development rules.

## Requirements

- Node.js 22.12+ within the 22.x line, or Node.js 24.x; npm.
- Python 3.14 (the currently validated Windows baseline).
- Git. Staging and committing are user-managed unless explicitly requested.

## Frontend

From the repository root in PowerShell, set the same `CV_SERVICE_API_KEY` used by CVService in this terminal's environment. Use a canonical lowercase UUIDv4. Start Vite at the default loopback origin:

```powershell
Set-Location 'Web App'
npm ci
npm run dev
```

Open the local URL printed by Vite. To validate and build:

```powershell
npm run check
npm test
npm run build
```

React, React DOM, Axios, and `react-webcam` are the application dependencies. Streaming uses the browser's native WebSocket API. Add Three.js/React Three Fiber when scene work begins.

Tailwind CSS is configured through `@tailwindcss/vite` and imported in `Web App/src/index.css`. Use utility classes directly in JSX, for example `className="flex gap-4"`. Existing global styles live in `@layer base` so utilities can override them. Tailwind's Preflight reset is enabled. No separate Tailwind configuration or PostCSS setup is required; `npm ci` installs the locked build dependencies.

### Camera frame sender

The camera stays off until **Start camera** is selected. The UI discloses the destination before permission is requested. It sends unmirrored JPEG frames, capped at 640×480 and approximately 15 samples/second, with one frame in flight. Audio is disabled. **Stop camera** releases media tracks and closes the stream; hiding the tab pauses transmission and returning starts a fresh stream. Failed connections retry at most five times with backoff; protocol incompatibility ends camera use immediately. Captures and results are not stored or logged.

Open `http://127.0.0.1:5173`. The browser uses the page's origin for `/api/health/` and `/api/v1/stream`. Vite forwards those two paths to `127.0.0.1:8000` and supplies the `x-api-key` header on each request or WebSocket upgrade. The key stays in the two server processes. Use `VITE_CV_STREAM_URL` only as a public URL override when another authenticated proxy serves both paths. HTTPS pages require `wss://`.

Axios uses `/api` as the default base path. Before each WebSocket attempt it requires HTTP 200 with `{"status":"ok"}` from `GET /api/health/` within three seconds. If the check fails, Start can retry. Stop, hiding the tab, and unmount cancel pending checks.

The browser waits for `stream:started` before sending images and for a matching `frame:ack` or recoverable rejection before sending the next frame. FastAPI sends a receipt after validation and discards the pixels. [Versioned streaming contract](docs/streaming-protocol.md)

For an end-to-end check, run both apps and open `/tests/camera-stream.html?mode=live` on Vite. Select Start camera and check that the receipt count increases. Use the visibility controls to check that receipts pause and a new connection opens when visible. Select Stop camera to release the synthetic tracks. The default fixture mode uses an in-memory receiver. Use `?mode=unhealthy` to check the failure path. All modes use generated video.

## CV service

From the repository root in PowerShell, create the environment if it does not already exist:

```powershell
py -3.14 -m venv CVService/venv
```

Install the lock and start the service from `CVService`. Generate a key once and supply the same value to Vite in its own terminal. On macOS or Linux shells, use `venv/bin/python` and export `CV_SERVICE_API_KEY` in both shells.

```powershell
Set-Location CVService
& './venv/Scripts/python.exe' -m pip install -r requirements.lock
& './venv/Scripts/python.exe' -m pip check
$env:CV_SERVICE_API_KEY = [guid]::NewGuid().ToString()
& './venv/Scripts/python.exe' -m src
```

The launcher applies the WebSocket size and receive queue limits. The API docs are at <http://127.0.0.1:8000/docs>. The service requires the key on `/api` requests and also validates WebSocket origins. Set `CV_ALLOWED_ORIGINS` to a comma-separated list of exact trusted origins for other local clients. It defaults to `http://127.0.0.1:5173` and `http://localhost:5173`. HTTP CORS permits these origins to preflight GET requests with `x-api-key`. Keep this setup on loopback.

From `CVService`, run `python -m unittest discover -s tests -v` with the activated environment for real loopback HTTP and WebSocket tests. The suite uses a generated test key and JPEGs.

`CVService/requirements.in` lists direct dependencies. `requirements.lock` pins all resolved runtime packages from the validated Windows/Python 3.14 environment; it is not a claim of cross-platform support or a hash-verified lock. MediaPipe requires the contrib OpenCV distribution: do not install another OpenCV variant alongside it.

After changing direct dependencies, install them in the service environment, run `pip check` and import checks, then regenerate the lock body with `python -m pip freeze --exclude pip`, preserving its header. Review changes before committing. Verify actual inference separately when a versioned model and consented fixture are added.

## Feature order

1. Add MediaPipe hand/gesture tracking and measure the CV MVP.
2. Build a basic scene with mouse/keyboard fallback.
3. Map tracking observations into reliable scene controls.
4. Add public admission and validate load, abuse handling, and transport security before deployment.

Keep the CV service independent of portfolio content. Target 60 FPS with a documented 30 FPS minimum quality mode; rendering must continue when tracking or the connection slows. Develop one feature/fix per chat; stage or commit only when explicitly requested. Cloud hosting and a separate application backend are deferred.
