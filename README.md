# Trebesin 3D

Interactive portfolio for school and personal projects. Three illustrative models float in a full-screen Three.js gallery. The upper-right panel controls the optional camera, with project details directly beneath it.

The React app streams opt-in camera capture to FastAPI through a local Vite proxy. CVService validates each JPEG, runs MediaPipe Hand Landmarker, and returns up to two sets of 21 joints. The browser draws those joints and displays the gesture state recognized by CVService. [Task 3 implementation and acceptance plan](docs/hand-tracking-plan.md). See [AGENTS.md](AGENTS.md) for requirements and development rules.

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

## Exploring the gallery

Hover or focus a project to inspect it. Click, tap, or press Enter to keep its details open. Drag a model to turn it. Tab reveals the keyboard project list, and the arrow keys turn the focused model. Escape, the close button, or a click in empty space clears a selection. Browsers without WebGL 2 show the project list directly. The portfolio works with the camera off.

The three exhibits occupy stations spanning 29.5 world units in depth. Drag empty space to orbit or scroll to travel. With the scene focused, W/S moves forward and back, A/D strafes, the arrow keys orbit, and Home resets the camera and pivot.

Selecting an exhibit brings the camera in close and locks the orbit pivot to the exhibit. Move an open palm sideways or use the two-finger turn gesture to orbit horizontally. Move an open palm up or down to orbit vertically. Two-hand zoom adjusts the viewing distance. Click away, press Escape, or close the details to return to the camera position and angle from before selection.

In camera mode, the scene consumes the service’s existing gesture observations. Point to inspect a model and bend the index finger to select the last pointed location. One open palm pans the camera and its orbit pivot sideways at 9 world units per second or vertically at 6.75. Two extended fingers orbit the camera around the center of the exhibits, reaching 1.85 radians per second in about 120 ms. The orbit shortens near walls to keep the camera inside the hall. Spreading or closing two open palms adjusts the orbit distance at 18 world units per second while the service reports motion. Returning to the rotation-ready pose slows the turn to a stop within 120 ms. Pan and zoom stop on their ready poses, and tracking loss or expiry stops all gesture motion immediately. An intentional selection stays open until dismissed. The fingertip’s unmirrored image coordinates map to the entire gallery, mirrored once horizontally. [Gesture contract](docs/gesture-rules.md)

## Camera hand tracking

Select **Start camera** and allow camera access. The mirrored preview draws landmarks over your hand as you move. The browser samples fresh video frames at up to about 18 frames per second and sends unmirrored JPEGs at up to 640×480, with one frame in flight. Audio is disabled. The app processes frames in memory and neither records nor logs frames or tracking results.

Each hand uses one color for its joints and bones, saturated blue or purple. The overlay matches nearby palms between fresh samples to keep colors steady when observation order changes. Color assignments reset when tracking clears and do not identify anatomical left or right hands.

The camera panel shows hand count, cursor or camera mode, and the current pan, rotation or zoom direction. Holding a camera pose still shows it as ready. A quick index bend in cursor mode reports a single selection event. [Gesture rules](docs/gesture-rules.md)

Open the gallery with `?debug=select` to see how many valid select results the browser has received, the last frame and arrival time, and whether the scene used it to pick an exhibit. The readout stays visible after the gesture and resets on reload. [Open select debug](http://127.0.0.1:5173/?debug=select)

An empty result clears the outline immediately, and a tracking sample expires 200 ms after capture. Hiding the tab pauses transmission, and returning starts a fresh stream. **Stop camera** releases the camera tracks and closes the stream.

For measured fast-motion lag, browser and service timings, and the effect of changing capture rate or JPEG size, see the [hand-tracking performance analysis](docs/hand-tracking-performance.md).

## Verification

Run the frontend checks and build from `Web App`:

```text
npm run check
npm test
npm run build
```

Run the CVService tests from `CVService` after setting up the model. Use the same virtual environment Python as above with `-m unittest discover -s tests -v`. The suite uses loopback HTTP and WebSocket connections, a generated key, and a [public MediaPipe hand fixture](tests/fixtures/README.md).

For a browser check, run both apps and open [the live camera fixture](http://127.0.0.1:5173/tests/camera-stream.html?mode=live). Select **Start camera** to send generated video through CVService. Look for a moving outline and a rising `withHands` count. Use **Show / hide test hand** to check that the outline disappears and returns. The fixture uses a generated video track.

The automatic scene fixture checks hover, tracking loss, selection, two-hand zoom, both overlay colors, turning, returning to the entrance, and camera cleanup. It uses generated video and a mock socket. Run it in a foreground tab at 1280 × 800 or 360 × 740. [Run the scene check](http://127.0.0.1:5173/tests/camera-stream.html?mode=scene)

## Development notes

- The frontend uses React, TypeScript, Vite, Tailwind CSS, and Lucide React icons. React Three Fiber renders the Three.js gallery. Each exhibit uses one combined mesh for rendering and picking. The scene consumes fresh tracking observations independently of camera capture and rendering cadence. Write Tailwind utility classes directly in JSX. Keep global defaults in `@layer base` in `Web App/src/index.css`.
- `CVService/requirements.in` lists direct dependencies. The lock was generated on Windows with Python 3.14. Verify native packages on your platform before claiming support. Use only the pinned `opencv-contrib-python` distribution.
- After changing Python dependencies, run `pip check` and import checks, then regenerate the lock body with `python -m pip freeze --exclude pip` using the virtual environment. Preserve the lock header and review the diff.

## Feature order

1. Benchmark the integrated scene and tracking on supported hardware.
2. Refine gesture mappings and project content using those measurements.
3. Add public admission and validate load, abuse handling, and transport security before deployment.

Keep the CV service independent of portfolio content. Target 60 FPS with a documented 30 FPS minimum quality mode. Rendering must continue when tracking or the connection slows. Cloud hosting and a separate application backend are deferred.
