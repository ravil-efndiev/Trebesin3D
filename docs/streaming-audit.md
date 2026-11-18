# Streaming audit follow-up

## Findings

- [x] **P2 · Strip browser credentials at the Vite proxy.** The development proxy removes browser credentials and custom headers before forwarding health requests and WebSocket upgrades. A loopback test inspects the headers received upstream. [Proxy](../Web%20App/vite.config.ts)
- [x] **P2 · Bound frame processing time.** A two-second deadline closes the stream with a correlated fatal error. A running decoder retains its slot until it exits. The capacity regression test checks admission before and after cleanup. [Stream handler](../CVService/src/api/v1/websocket.py)
- [x] **P2 · Enforce a single JPEG per frame.** The decoder checks the detected format, frame count, and dimensions before loading pixels. The integration test rejects a two-picture MPO and accepts the next ordinary JPEG on the same stream. [JPEG validator](../CVService/src/api/v1/protocol.py)
- [x] **P2 · Stop after sustained frame rejection.** Three consecutive matching frame rejections stop capture and display a recovery message. A matching successful response resets the count, and stale responses are ignored. [Browser stream](../Web%20App/src/utils/stream.ts)
- [ ] **P3 · Handle slow WebSocket closes.** A simulated transport delay caused timeout cleanup to close an already-disconnected Starlette socket and raise `WebSocketDisconnected`. The slot was released. Give one path ownership of closing and test delayed close. [Stream handler](../CVService/src/api/v1/websocket.py)
- [ ] **P3 · Validate the Vite proxy key at startup.** Vite currently starts with a missing key and returns a 404 for the health request. Report missing or invalid configuration in the development terminal. Keep production builds independent of the key. [Vite configuration](../Web%20App/vite.config.ts)
- [ ] **Dependency · Track the picomatch advisory.** The audit found one high-severity advisory on locked `picomatch@4.0.7`, propagated through five development-package entries. The audit found no untrusted glob input in the streaming routes and no findings in the production-only npm audit. Track the upstream fix, review a compatible tooling update, and rerun the audit. [GitHub advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)

## Test gaps and release requirements

- [ ] **Automate tests at the Vite proxy boundary.** Cover health and WebSocket forwarding, Host and Origin checks, and upstream credential handling. The Python suite currently connects directly to CVService. [Proxy](../Web%20App/vite.config.ts)
- [ ] **Strengthen the malformed-JPEG test.** Assert the full nonfatal `INVALID_FRAME` response. The current check for `frameId` also passes on an incorrect acknowledgment. [Service tests](../CVService/tests/test_streaming.py)
- [ ] **Verify transport limits using the service launcher.** Cover message rate, start and idle expiry, slow sends, and capacity recovery during processing. Exercise or share the launcher settings so duplicated test configuration cannot drift. [Launcher](../CVService/src/__main__.py)
- [ ] **Migrate the deprecated Uvicorn WebSocket backend.** Verify equivalent message-size and receive-queue bounds and keep compression disabled through the migration. [Launcher](../CVService/src/__main__.py)
- [ ] **Gate public access.** Add HTTPS/WSS, short-lived client admission, and limits shared across connections and workers. The service key authenticates Vite to CVService, and the four-slot limit applies per process. Verify sustained load before release. [Streaming contract](streaming-protocol.md)
- [ ] **Verify physical camera behavior and future inference.** The audit tested generated video over the real connection. Exercise actual hardware and validate inference when it is implemented.
