# Trebesin 3D

Interactive portfolio for school and personal projects. The planned experience uses camera-based hand tracking to interact with a Three.js scene.

The React app streams opt-in camera capture to FastAPI through a local Vite proxy. CVService validates each JPEG, runs MediaPipe Hand Landmarker, and returns up to two sets of 21 joints. The browser connects those joints over the live preview. [Task 3 implementation and acceptance plan](docs/hand-tracking-plan.md). See [AGENTS.md](AGENTS.md) for requirements and development rules.

## Requirements

- Node.js 22.12+ within the 22.x line, or Node.js 24.x; npm.
- Python 3.14 (the currently validated Windows baseline).
- Git. Staging and committing are user-managed unless explicitly requested.

## Local setup

Open two terminals at the repository root, one for CVService and one for Vite. Generate a key once:

```text
node -p "require('node:crypto').randomUUID()"
```

Set `CV_SERVICE_API_KEY` in both terminals. Replace `YOUR_UUID` with the same generated value in each.

| Shell | Command |
| --- | --- |
| macOS or Linux (Bash or Zsh) | `export CV_SERVICE_API_KEY="YOUR_UUID"` |
| Windows PowerShell | `$env:CV_SERVICE_API_KEY = "YOUR_UUID"` |

### 1. Start CVService

Run the commands for your platform in the first terminal. If you already have a Python 3.14 environment in `CVService/venv`, skip the `-m venv` command.

#### macOS and Linux

```sh
cd CVService
python3.14 -m venv venv
./venv/bin/python -m pip install -r requirements.lock
./venv/bin/python -m pip check
./venv/bin/python -m src.model
./venv/bin/python -m src
```

#### Windows PowerShell

```powershell
cd CVService
py -3.14 -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.lock
./venv/Scripts/python.exe -m pip check
./venv/Scripts/python.exe -m src.model
./venv/Scripts/python.exe -m src
```

The model setup command downloads the official MediaPipe float16 v1 bundle to `CVService/models/hand_landmarker.task` and verifies its size and SHA-256. It also verifies an existing file. If verification fails, move the damaged file aside and rerun the model setup command. [Model source and checksum](CVService/src/model.py)

CVService listens on `127.0.0.1:8000`. The launcher applies WebSocket message size and receive queue limits. [Local API docs](http://127.0.0.1:8000/docs)

### 2. Start the frontend

Run the same commands on macOS, Linux, and Windows in the second terminal:

```text
cd "Web App"
npm ci
npm run dev
```

Open [the local app](http://127.0.0.1:5173). Vite proxies `/api/health/` and `/api/v1/stream` to CVService and adds the `x-api-key` header server-side.

CVService accepts `http://127.0.0.1:5173` and `http://localhost:5173` by default. For other local clients, set `CV_ALLOWED_ORIGINS` to a comma-separated list of exact trusted origins. Use `VITE_CV_STREAM_URL` to point the browser at another authenticated proxy that serves both endpoints. HTTPS pages require `wss://`. [Streaming protocol and connection lifecycle](docs/streaming-protocol.md)

## Camera hand tracking

Select **Start camera** and allow camera access. The mirrored preview draws landmarks over your hand as you move. The browser sends unmirrored JPEGs to the displayed service at up to 640×480 and about 15 frames per second, with one frame in flight. Audio is disabled. The app processes frames in memory and neither records nor logs frames or tracking results.

An empty result clears the outline immediately, and a tracking sample expires 200 ms after capture. Hiding the tab pauses transmission, and returning starts a fresh stream. **Stop camera** releases the camera tracks and closes the stream.

## Verification

Run the frontend checks and build from `Web App`:

```text
npm run check
npm test
npm run build
```

Run the CVService tests from `CVService` after setting up the model. Use the same virtual environment Python as above with `-m unittest discover -s tests -v`. The suite uses loopback HTTP and WebSocket connections, a generated key, and a [public MediaPipe hand fixture](tests/fixtures/README.md).

For a browser check, run both apps and open [the live camera fixture](http://127.0.0.1:5173/tests/camera-stream.html?mode=live). Select **Start camera** to send generated video through CVService. Look for a moving outline and a rising `withHands` count. Use **Show / hide test hand** to check that the outline disappears and returns. The fixture uses a generated video track.

## Development notes

- The frontend uses React, TypeScript, Vite, and Tailwind CSS. Write Tailwind utility classes directly in JSX. Keep global defaults in `@layer base` in `Web App/src/index.css`.
- `CVService/requirements.in` lists direct dependencies. The lock was generated on Windows with Python 3.14. Verify native packages on your platform before claiming support. Use only the pinned `opencv-contrib-python` distribution.
- After changing Python dependencies, run `pip check` and import checks, then regenerate the lock body with `python -m pip freeze --exclude pip` using the virtual environment. Preserve the lock header and review the diff.

## Feature order

1. Define gesture observations and benchmark the CV MVP on target hardware.
2. Build a basic scene with mouse/keyboard fallback.
3. Map tracking observations into reliable scene controls.
4. Add public admission and validate load, abuse handling, and transport security before deployment.

Keep the CV service independent of portfolio content. Target 60 FPS with a documented 30 FPS minimum quality mode. Rendering must continue when tracking or the connection slows. Cloud hosting and a separate application backend are deferred.
