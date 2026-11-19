# Camera streaming protocol v3

The camera preview uses v3 for hand landmarks and gesture state. The same endpoint accepts v2 for landmarks and v1 for JPEG receipts. The start message selects the version for the stream. The server echoes it in the start response and requires it in every frame header.

## Connection and lifecycle

- The browser uses its page origin for `GET /api/health/` and the native WebSocket at `/api/v1/stream`. The loopback Vite proxy forwards both requests to CVService at `127.0.0.1:8000` and adds the `x-api-key` header from its process environment. Direct service clients supply the same header. The WebSocket upgrade also requires exactly one trusted `Origin`. HTTP CORS permits configured origins to preflight GET with `x-api-key`.
- Before each socket attempt, Axios requires HTTP 200 and `{"status":"ok"}` within three seconds. This checks authenticated reachability. Failure ends camera use until the next Start. Stop, pause, and unmount cancel pending checks. `VITE_CV_STREAM_URL` can point to another proxy serving both paths. HTTPS pages require `wss://`.
- Camera permission and transmission start only after **Start camera**. Audio is disabled. Frames leave the browser for the displayed CV service; they are not recorded by the frontend.
- JSON control messages use text WebSocket messages. Binary messages carry frames. All JSON objects must match the documented fields; unknown types and extra fields are rejected by the client.
- Client sends `{"type":"stream:start","requestId":"<UUID>","protocolVersion":3}`. Server responds `{"type":"stream:started","requestId":"<same>","protocolVersion":3,"streamId":"<unique ID>"}` after admission and stream state initialization. IDs are nonempty strings of at most 64 UTF-16 code units. Each start creates a fresh stream.
- Client sends `{"type":"stream:stop","requestId":"<UUID>","streamId":"<active ID>"}` on stop where the socket is writable, then closes the connection without waiting. Server may respond `{"type":"stream:stopped","requestId":"<same>","streamId":"<same>"}`. Disconnect must perform the same cleanup even if stop was never received. Stop is best effort; the UI stops capture immediately.
- Hiding the page closes its current stream and cancels pending capture. The camera remains enabled while hidden, but no frames are transmitted. Returning to the page creates a fresh stream. Stop/unmount/camera failure releases media tracks, timers, and connections. Late encodes and messages from previous connections are ignored.

The development proxy forwards only the headers needed for HTTP and WebSocket negotiation and injects its own service key. The browser stops capture after three consecutive correlated frame rejections. A matching successful frame response resets the count.

## Binary frame message

One WebSocket message contains:

```text
[4-byte unsigned big-endian header byte length][UTF-8 JSON header][JPEG bytes]
```

Header example:

```json
{"type":"stream:frame","protocolVersion":3,"streamId":"example","frameId":1,"capturedAtMs":1234.5,"width":640,"height":480,"mimeType":"image/jpeg"}
```

- Header length: 1–1024 bytes. JPEG length: 1–262144 bytes (256 KiB). Total message maximum: 263172 bytes. No base64 or data URLs.
- `frameId`: positive safe integer, strictly increasing within a stream, starting at 1. `capturedAtMs`: finite, nonnegative `performance.now()` timestamp taken immediately before drawing the current video frame; it must increase within the stream.
- Images are upright and unmirrored, maximum 640×480 and 307200 pixels. The browser preserves the camera's actual aspect ratio, does not upscale, and starts at JPEG quality 0.75. Dimensions in the header must equal the encoded image dimensions.
- The browser samples newly presented video frames with `requestVideoFrameCallback` and uses the video frame’s media timestamp to skip duplicates. It polls the video clock if the callback API is unavailable. It also switches to polling for the rest of the camera session if no usable callback arrives within 150 ms after the next sample is due. Sampling averages up to 18 Hz, with at most one interval of scheduling credit to account for discrete video frames. Only one encode or frame may be pending per stream. The browser skips frames while busy and keeps no image backlog.
- The server checks ownership and ordering before decoding. It uses the JPEG header's actual dimensions to check the envelope and pixel limit before loading pixels. A frame ID and timestamp are consumed after these envelope checks, even if JPEG validation subsequently rejects the frame.

## Results and errors

Each valid v3 frame receives one text response after inference. An empty scene produces:

```json
{"type":"tracking:result","streamId":"example","frameId":1,"hands":[],"gesture":"idle"}
```

A result contains zero to two hand objects. Each has one field, `landmarks`, an array of exactly 21 finite `[x,y,z]` triples in MediaPipe order (wrist, then four joints per finger from thumb to little finger). Coordinates use the submitted unmirrored image. The origin is top left, x increases to the right in units of image width, and y increases downward in units of image height. Points can fall beyond image edges. Depth is relative to the wrist in approximate x units, with smaller values closer to the camera. It has no calibrated world scale. The service rounds coordinates to five decimal places and accepts magnitudes up to 8. Array order applies only to this sample and conveys no persistent hand identity.

The browser matches both IDs to its outstanding frame. It draws using the capture dimensions and expires the sample 200 ms after its local capture timestamp. Empty results, matching rejections, disconnect, stop, and pause clear the overlay. A stale but matching result still frees the frame slot. A fresh empty result displays `0 hands · Idle`. Expired or unavailable tracking clears the gesture label. V2 responses carry landmarks only and omit `gesture`. V1 continues to return `{"type":"frame:ack","streamId":"example","frameId":1}` after JPEG validation.

### Gesture state in v3

The required `gesture` string describes the submitted frame. Hand count comes from `hands.length`. Each stream recognizes gestures independently. The rules run on the service and consumers map the observations to their own UI. [Gesture rules](gesture-rules.md)

| Observed pose | Allowed gesture values |
| --- | --- |
| Zero hands or an unrecognized pose with one or two hands | `idle` |
| One hand with only the index extended | `cursor` |
| A quick bend of that index with the other fingers folded | `select` for one frame |
| One open palm facing the camera | `pan_ready`, `pan_left`, `pan_right`, `pan_up`, `pan_down` |
| One hand with exactly two fingers extended | `rotate_ready`, `rotate_left`, `rotate_right` |
| Two open palms | `zoom_ready`, `zoom_in`, `zoom_out` |

Pose classification uses the metric landmark chains for finger extension and the wrist, index and pinky knuckles plus the model’s handedness for palm orientation. Motion uses the palm center in the image plane. Horizontal directions follow the mirrored preview, and up is toward the image top. Pan reports the dominant axis. Rotation uses horizontal displacement. Zoom compares the distance between palm centers in aspect-corrected coordinates, independent of the order of the two hands.

Entering a camera control establishes its motion reference. A displacement of 8% of palm width (at least 0.5% of image width) triggers a direction. It returns to ready after 100 ms without significant movement. A straight index arms selection. Bending it within 160 ms of the last fully extended sample emits one `select`; extension is required to rearm. Consumers can use their last cursor position for selection. All intervals use successive capture timestamps on the same stream. Loss, a rejected image, a new stream or a capture gap of at least 200 ms clears gesture history. An incompatible pose cancels the previous control.

Errors use:

```json
{"type":"stream:error","code":"INVALID_FRAME","message":"Frame rejected.","fatal":false,"streamId":"example","frameId":1}
```

- `code`: 1–64 characters; `message`: 1–256 characters; `fatal`: boolean. Optional fields: `requestId`, `streamId`, `frameId` (same constraints as their request counterparts).
- Only single-image JPEG input is supported. A two-second server processing deadline closes the stream with a fatal `FRAME_TIMEOUT` error. The service retains capacity until the worker finishes.
- A nonfatal JPEG rejection uses `INVALID_FRAME` and includes the active stream ID and frame ID. Invalid metadata, malformed messages, and stream ownership or ordering errors are fatal. Invalid controls echo the request ID when it can be validated. The server closes with code 1008 after a fatal error. An oversized message closes with code 1009.
- Responses must be text JSON, maximum 4096 UTF-8 bytes. Invalid messages close the connection and end camera use, rather than silently falling back to another protocol.

## Timeouts, recovery, and server requirements

- Connect/start timeout: 3 seconds per phase. The browser allows 2 seconds for capture, encode and receipt once it starts copying a frame. It allows 15 seconds to find a usable frame after stream start or the last successful capture. The user can stop while waiting for camera permission.
- No queued outgoing data is allowed before the browser sends a new frame. The server launcher caps WebSocket message size at 263172 bytes, uses a receive queue of one message, and disables WebSocket compression. It admits up to four sockets per process and allows 20 messages per second per socket with a burst of four. Text controls are limited to 4096 UTF-8 bytes.
- Unexpected disconnects and timeouts retry with jittered exponential backoff: 250 ms base, doubling to a maximum of 8 seconds, at most five automatic retries before camera use ends. A matching successful frame response resets the retry budget. A new explicit Start also resets it.
- Frame responses act as active-stream liveness checks; no separate application ping is required while frames are flowing. Connection, handshake, media-readiness, and frame deadlines bound other waits.
- The server gives a socket three seconds to start and allows 20 seconds of active inactivity. Each send has a 500 ms deadline. It handles one message at a time per socket and performs JPEG decoding and synchronous VIDEO inference off the event loop. Each v2 or v3 start opens a fresh tracker from the pinned local model. The server allows two seconds for a frame and three for tracker startup. A missed deadline closes the connection, and capacity remains reserved until any running native call finishes and its tracker closes. Model setup or inference failures return a fatal error. There is no application frame queue.
- Compare durations only within one monotonic clock. The server assigns integer VIDEO timestamps from its own monotonic clock, advancing by at least one millisecond per inference in the stream.
- This setup is for loopback development. Before public deployment, add HTTPS/WSS, short-lived browser admission with expiry, shared admission and rate limits across processes, and load and abuse testing.
