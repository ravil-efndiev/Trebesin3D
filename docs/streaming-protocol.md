# Camera streaming protocol v1

The browser and CVService exchange validated JPEGs and frame receipts in local development. Hand detection and tracking results are planned separately.

## Connection and lifecycle

- The browser uses its page origin for `GET /api/health/` and the native WebSocket at `/api/v1/stream`. The loopback Vite proxy forwards both requests to CVService at `127.0.0.1:8000` and adds the `x-api-key` header from its process environment. Direct service clients supply the same header. The WebSocket upgrade also requires exactly one trusted `Origin`. HTTP CORS permits configured origins to preflight GET with `x-api-key`.
- Before each socket attempt, Axios requires HTTP 200 and `{"status":"ok"}` within three seconds. This checks authenticated reachability. Failure ends camera use until the next Start. Stop, pause, and unmount cancel pending checks. `VITE_CV_STREAM_URL` can point to another proxy serving both paths. HTTPS pages require `wss://`.
- Camera permission and transmission start only after **Start camera**. Audio is disabled. Frames leave the browser for the displayed CV service; they are not recorded by the frontend.
- JSON control messages use text WebSocket messages. Binary messages carry frames. All JSON objects must match the documented fields; unknown types and extra fields are rejected by the client.
- Client sends `{"type":"stream:start","requestId":"<UUID>","protocolVersion":1}`. Server responds `{"type":"stream:started","requestId":"<same>","protocolVersion":1,"streamId":"<unique ID>"}` after admission and stream state initialization. IDs are nonempty strings of at most 64 UTF-16 code units. Each start creates a fresh stream.
- Client sends `{"type":"stream:stop","requestId":"<UUID>","streamId":"<active ID>"}` on stop where the socket is writable, then closes the connection without waiting. Server may respond `{"type":"stream:stopped","requestId":"<same>","streamId":"<same>"}`. Disconnect must perform the same cleanup even if stop was never received. Stop is best effort; the UI stops capture immediately.
- Hiding the page closes its current stream and cancels pending capture. The camera remains enabled while hidden, but no frames are transmitted. Returning to the page creates a fresh stream. Stop/unmount/camera failure releases media tracks, timers, and connections. Late encodes and messages from previous connections are ignored.

## Binary frame message

One WebSocket message contains:

```text
[4-byte unsigned big-endian header byte length][UTF-8 JSON header][JPEG bytes]
```

Header example:

```json
{"type":"stream:frame","protocolVersion":1,"streamId":"example","frameId":1,"capturedAtMs":1234.5,"width":640,"height":480,"mimeType":"image/jpeg"}
```

- Header length: 1–1024 bytes. JPEG length: 1–262144 bytes (256 KiB). Total message maximum: 263172 bytes. No base64 or data URLs.
- `frameId`: positive safe integer, strictly increasing within a stream, starting at 1. `capturedAtMs`: finite, nonnegative `performance.now()` timestamp taken immediately before drawing the current video frame; it must increase within the stream.
- Images are upright and unmirrored, maximum 640×480 and 307200 pixels. The browser preserves the camera's actual aspect ratio, does not upscale, and starts at JPEG quality 0.75. Dimensions in the header must equal the encoded image dimensions.
- Sampling is timer driven and capped near 15 Hz, independent of React rendering. Only one capture/encode/frame may be pending per stream. If video is not ready or has no new frame, skip that sampling slot. There is no image backlog.
- The server checks ownership and ordering before decoding. It uses the JPEG header's actual dimensions to check the envelope and pixel limit before loading pixels. A frame ID and timestamp are consumed after these envelope checks, even if JPEG validation subsequently rejects the frame.

## Receipts and errors

After consuming a frame and releasing its processing slot, server sends:

```json
{"type":"frame:ack","streamId":"example","frameId":1}
```

This is a transport/processing receipt, not an inference result and not an empty-hand result. When inference is added, document and validate `tracking:result` separately, including explicit `hands: []`, coordinate/mirroring rules, identities, and gesture semantics. Do not acknowledge receipt early and then grow an unbounded inference queue.

Errors use:

```json
{"type":"stream:error","code":"INVALID_FRAME","message":"Frame rejected.","fatal":false,"streamId":"example","frameId":1}
```

- `code`: 1–64 characters; `message`: 1–256 characters; `fatal`: boolean. Optional fields: `requestId`, `streamId`, `frameId` (same constraints as their request counterparts).
- A nonfatal JPEG rejection uses `INVALID_FRAME` and includes the active stream ID and frame ID. Invalid metadata, malformed messages, and stream ownership or ordering errors are fatal. Invalid controls echo the request ID when it can be validated. The server closes with code 1008 after a fatal error. An oversized message closes with code 1009.
- Responses must be text JSON, maximum 4096 UTF-8 bytes. Invalid messages close the connection and end camera use, rather than silently falling back to another protocol.

## Timeouts, recovery, and server requirements

- Connect/start timeout: 3 seconds per phase. Capture/encode/result timeout: 2 seconds total per frame. These are failure deadlines, not latency or inference benchmarks. Media startup has a separate 15-second readiness deadline after permission is granted; the user may stop while permission is pending.
- No queued outgoing data is allowed before the browser sends a new frame. The server launcher caps WebSocket message size at 263172 bytes, uses a receive queue of one message, and disables WebSocket compression. It admits up to four sockets per process and allows 20 messages per second per socket with a burst of four. Text controls are limited to 4096 UTF-8 bytes.
- Unexpected disconnects and timeouts retry with jittered exponential backoff: 250 ms base, doubling to a maximum of 8 seconds, at most five automatic retries before camera use ends. A matching frame receipt resets the retry budget. A new explicit Start also resets it.
- Frame responses act as active-stream liveness checks; no separate application ping is required while frames are flowing. Connection, handshake, media-readiness, and frame deadlines bound other waits.
- The server gives a socket three seconds to start and allows 20 seconds of active inactivity. Each send has a 500 ms deadline. It handles one message at a time per socket and decodes each JPEG in a worker thread. Stop and disconnect take effect when the current decode returns. There is no application frame queue.
- Compare durations only within one monotonic clock. The server can echo browser timestamps later, but must not subtract them from its own clock. Inference timestamps must be strictly increasing and independently validated/assigned by the server.
- This setup is for loopback development. Before public deployment, add HTTPS/WSS, short-lived browser admission with expiry, shared admission and rate limits across processes, and load and abuse testing.
