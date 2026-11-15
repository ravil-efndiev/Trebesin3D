# Trebesin 3D

Interactive portfolio for school and personal projects. The planned experience uses camera-based hand tracking to interact with a Three.js scene.

Current scope: a minimal React/TypeScript/Vite application and a runnable FastAPI application. Camera capture, Socket.IO transport, inference, gestures, and 3D rendering are subsequent features. See [AGENTS.md](AGENTS.md) for requirements and development rules.

## Requirements

- Node.js 22.12+ within the 22.x line, or Node.js 24.x; npm.
- Python 3.14 (the currently validated Windows baseline).
- Git for the feature-per-commit workflow.

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
npm run build
```

Only React and React DOM are installed as application dependencies. Add Socket.IO and Three.js/React Three Fiber when implementing those features.

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

1. Define the versioned streaming contract and implement bounded Socket.IO image transport with camera capture.
2. Implement reusable MediaPipe hand/gesture tracking and measure the CV MVP.
3. Build a basic scene with mouse/keyboard fallback.
4. Map tracking observations into reliable scene controls.
5. Optimize, polish the UI, and validate security before public release.

Keep the CV service independent of portfolio content. Target 60 FPS with a documented 30 FPS minimum quality mode; rendering must continue when tracking or the connection slows. Develop one feature/fix per chat and commit each successful change. Cloud hosting and a separate application backend are deferred.
