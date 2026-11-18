# Trebesin 3D

Interactive portfolio for school and personal projects. The planned experience uses camera-based hand tracking to interact with a Three.js scene.

Current scope: a React/TypeScript/Vite application with opt-in camera capture and a native WebSocket frame sender, plus a FastAPI scaffold. The frontend requires the server protocol described below; the Python text-echo handler does not implement it yet. Inference, gestures, and 3D rendering are subsequent features. See [AGENTS.md](AGENTS.md) for requirements and development rules.

## Requirements

- Node.js 22.12+ within the 22.x line, or Node.js 24.x; npm.
- Python 3.14 (the currently validated Windows baseline).
- Git. Staging and committing are user-managed unless explicitly requested.

## Frontend

From the repository root in PowerShell:

```powershell
Set-Location 'Web App'
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite. To validate and build:

```powershell
npm run check
npm test
npm run build
```

React, React DOM, and `react-webcam` are the application dependencies. Streaming uses the browser's native WebSocket API. Add Three.js/React Three Fiber when scene work begins.

Tailwind CSS is configured through `@tailwindcss/vite` and imported in `Web App/src/index.css`. Use utility classes directly in JSX, for example `className="flex gap-4"`. Existing global styles live in `@layer base` so utilities can override them. Tailwind's Preflight reset is enabled. No separate Tailwind configuration or PostCSS setup is required; `npm ci` installs the locked build dependencies.

### Camera frame sender

The camera stays off until **Start camera** is selected. The UI discloses the destination before permission is requested. It sends unmirrored JPEG frames, capped at 640×480 and approximately 15 samples/second, with one frame in flight. Audio is disabled. **Stop camera** releases media tracks and closes the stream; hiding the tab pauses transmission and returning starts a fresh stream. Failed connections retry at most five times with backoff; protocol incompatibility ends camera use immediately. Captures and results are not stored or logged.

The default endpoint is `ws://localhost:8000/api/v1/stream`. To change the port or host, copy `Web App/.env.example` to `Web App/.env.local`, set `VITE_CV_STREAM_URL` to the full URL, and restart Vite. This value is public browser configuration, not a service secret. HTTPS pages require a `wss://` endpoint.

The shared Axios client in `src/utils/api.ts` defaults to `http://localhost:8000/api` with a three-second timeout. Before each WebSocket connection attempt, the camera checks `GET /api/health/` on the configured service's HTTP(S) origin and requires HTTP 200 with `{"status":"ok"}`. A failed check ends camera use without opening a socket; Start retries it. Stop, hiding the tab, and unmount cancel pending checks. Cross-origin development requires CVService to allow the frontend origin through HTTP CORS; WebSocket origin checks remain separate. The browser fixture mocks Axios too; `?mode=unhealthy` verifies that failed health prevents a socket.

The [versioned streaming contract](docs/streaming-protocol.md) defines start/stop messages, binary JPEG framing, receipts, limits, deadlines, and required server behavior. The frontend waits for `stream:started` before sending images and `frame:ack` before sending the next frame. The existing Python text echo must be replaced with a compatible receiver before this works against CVService. A frame receipt is not a hand tracking result. Tests use synthetic frames and a fake socket; they do not require a camera or perform inference.

For browser verification, run Vite and open `/tests/camera-stream.html`. This development-only fixture generates canvas video and mocks the receiver in memory; it never accesses the physical camera or transmits frames. Its counters verify actual JPEG decoding, one pending frame, and stopped media tracks. Use its visibility buttons to exercise pause/restart, or query modes `denied`, `offline`, `incompatible`, `slow`, and `late` to exercise failure/recovery. The fixture is excluded from the production entry point.

## CV service

From the repository root in PowerShell, create the environment if it does not already exist:

```powershell
python -m venv CVService/venv
```

Install the lock and start the service; activation is optional:

```powershell
& './CVService/venv/Scripts/python.exe' -m pip install -r CVService/requirements.lock
& './CVService/venv/Scripts/python.exe' -m pip check
& './CVService/venv/Scripts/python.exe' -m uvicorn main:app --app-dir CVService/src --host 127.0.0.1 --port 8000 --reload
```

The API documentation is available at <http://127.0.0.1:8000/docs>. The initial app has no custom routes or inference model. Its OpenAPI title is `CV Service`.

`CVService/requirements.in` lists direct dependencies. `requirements.lock` pins all resolved runtime packages from the validated Windows/Python 3.14 environment; it is not a claim of cross-platform support or a hash-verified lock. MediaPipe requires the contrib OpenCV distribution: do not install another OpenCV variant alongside it.

After changing direct dependencies, install them in the service environment, run `pip check` and import checks, then regenerate the lock body with `python -m pip freeze --exclude pip`, preserving its header. Review changes before committing. Verify actual inference separately when a versioned model and consented fixture are added.

## Feature order

1. Implement the server side of the versioned native WebSocket streaming contract and validate it with browser camera capture.
2. Implement reusable MediaPipe hand/gesture tracking and measure the CV MVP.
3. Build a basic scene with mouse/keyboard fallback.
4. Map tracking observations into reliable scene controls.
5. Optimize, polish the UI, and validate security before public release.

Keep the CV service independent of portfolio content. Target 60 FPS with a documented 30 FPS minimum quality mode; rendering must continue when tracking or the connection slows. Develop one feature/fix per chat; stage or commit only when explicitly requested. Cloud hosting and a separate application backend are deferred.
