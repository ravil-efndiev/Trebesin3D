# Camera streaming protocol v1

Status: frontend contract. The current Python text-echo endpoint does not implement this protocol. This change implements the browser sender only; frame receipts are not hand detection or inference results.

## Connection and lifecycle

- Before each socket connection, the frontend uses its Axios client (base path `/api`) to request `GET /api/health/` on the matching HTTP(S) service origin. It requires HTTP 200 and `{"status":"ok"}` within three seconds. Failure prevents connection and ends camera use until the next explicit Start. Stop/pause/unmount abort pending health checks. HTTP health is only a reachability check, not stream admission, inference readiness, or authentication; HTTP CORS must be configured separately on the server.

- Native WebSocket endpoint: `ws://localhost:8000/api/v1/stream` in local development. Override the complete URL with `VITE_CV_STREAM_URL`. HTTPS pages require `wss://`.
- Camera permission and transmission start only after **Start camera**. Audio is disabled. Frames leave the browser for the displayed CV service; they are not recorded by the frontend.
- JSON control messages use text WebSocket messages. Binary messages carry frames. All JSON objects must match the documented fields; unknown types and extra fields are rejected by the client.
- Client sends `{"type":"stream:start","requestId":"<UUID>","protocolVersion":1}`. Server responds `{"type":"stream:started","requestId":"<same>","protocolVersion":1,"streamId":"<unique ID>"}` only after admission and tracker initialization. IDs are nonempty strings of at most 64 characters. Each connection/reconnection starts a new stream; no work is replayed.
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
- Server must validate actual codec, byte limits, header schema, stream ownership, ordering, image dimensions, and decoded pixel count before expensive inference. Claimed dimensions are not trusted. Server must enforce per-session rate/queue limits and global capacity, even against noncompliant clients.

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
- A nonfatal frame rejection must identify the active stream and pending frame; it releases that slot. A fatal error ends camera use. During startup, errors must echo the start request ID. Stale IDs cannot release current work.
- Responses must be text JSON, maximum 4096 UTF-8 bytes. Invalid messages close the connection and end camera use, rather than silently falling back to another protocol.

## Timeouts, recovery, and server requirements

- Connect/start timeout: 3 seconds per phase. Capture/encode/result timeout: 2 seconds total per frame. These are failure deadlines, not latency or inference benchmarks. Media startup has a separate 15-second readiness deadline after permission is granted; the user may stop while permission is pending.
- No queued outgoing data is allowed before sending a new frame. A backlogged socket is reset. The application enqueues at most one bounded frame plus a bounded control message; server transport receive/send buffers also need explicit bounds.
- Unexpected disconnects and timeouts retry with jittered exponential backoff: 250 ms base, doubling to a maximum of 8 seconds, at most five automatic retries before camera use ends. A matching frame receipt resets the retry budget. A new explicit Start also resets it.
- Frame responses act as active-stream liveness checks; no separate application ping is required while frames are flowing. Connection, handshake, media-readiness, and frame deadlines bound other waits.
- Server cleanup must invalidate obsolete results and release per-stream resources safely on stop, disconnect, timeout, and shutdown. Blocking decode/inference must use bounded execution outside the event loop.
- Compare durations only within one monotonic clock. The server can echo browser timestamps later, but must not subtract them from its own clock. Inference timestamps must be strictly increasing and independently validated/assigned by the server.
- Local development only until server-side origin checks, admission/expiry, connection/rate/capacity limits, bounded buffers, image validation, and slow-client handling are implemented. Public operation requires HTTPS/WSS. HTTP CORS alone does not protect a WebSocket.
