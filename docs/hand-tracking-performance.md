# Why the hand outline trails fast motion

Measured on 19 November 2026 against commit `263df79`, using the React app, Vite proxy and Python CVService on one Mac. The main finding is that **a result can arrive promptly while the outline on screen is already behind the hand**. In the fast-motion run, capture to the first rendering opportunity took **38 ms at p95**. Across rendering opportunities while an outline was visible, its source image was **124 ms old at p95**. A separate comparison with the video element found **74 pixels of movement between the preview frame and the outline’s frame** at p95, on a 640-pixel-wide image. At slow speed the gap was **8 pixels**.

The largest measured costs were the age of the video frame available to capture, the browser’s 15 Hz sampling and hold between results, and MediaPipe inference. Fast movement also changed what the service detected. Of 355 fast single-hand frames, 20 returned no hands and 54 returned two. Those effects call for different fixes. The measurements below distinguish a trailing outline, an outline that disappears, and an occasional long stall.

## Follow-up with video-frame-driven capture

The browser now samples newly presented video frames through `requestVideoFrameCallback`, with an 18 Hz target and one frame in flight. In a follow-up on the same Mac and 1,100 px/s fixture, each run contributed about 12 warm seconds. The timer control used 15 Hz, with pacing measured from the actual previous capture. [Current sampling rules](streaming-protocol.md#binary-frame-message)

| Fast-motion measurement | Timer at 15 Hz, 2 runs | Video callbacks at 15 Hz, 1 run | Video callbacks at 18 Hz, 2 runs |
| --- | ---: | ---: | ---: |
| Distinct source images / completed samples | 351 / 351 | 175 / 175 | 392 / 392 |
| Actual captures/s | 14.8–14.9 | 14.9 | 16.6 |
| Generated image → first render callback with new outline, p95 | 90 ms | 66 ms | 66 ms |
| Source-image age while the outline was visible, p95 | 126 ms | 117 ms | 115 ms |
| Gap between fresh, nonempty outlines, p95 | 133 ms | 117 ms | 100 ms |
| Upstream throughput | 2.31–2.33 Mbit/s | 2.33 Mbit/s | 2.60 Mbit/s |

The 18 Hz mode produced empty results on 19 of 392 frames. The test exercised the browser and real inference over loopback. Camera exposure and physical display latency remain unmeasured.

## What the timer-driven preview showed

The browser displays a continuously advancing video. The original timer copied the current video image about every 66.7 ms, encoded a JPEG, and sent it. The service returned joints for that particular image. The browser drew them immediately and kept them in that position until the next result or expiry. At a constant 1,100 input pixels/s the hand travels about 73 pixels in one tracking interval. At 120 pixels/s it travels 8 pixels. Both the preview and overlay are mirrored for display. The JPEG and landmark coordinates share the same unmirrored orientation. [Capture](../Web%20App/src/utils/camera.ts) · [Scheduling and expiry](../Web%20App/src/utils/stream.ts) · [Preview](../Web%20App/src/components/CameraView.tsx)

| Browser measurement | Slow, 120 px/s | Fast, 1,100 px/s | Fast, trial at 18 Hz |
| --- | ---: | ---: | ---: |
| Completed warm frames | 179 | 355 across two runs | 212 |
| Actual captures/s | 15.14 | 14.93 and 15.14 | 18.16 |
| Generated image → browser capture, p95 | 53 ms | 60 ms | 68 ms |
| Browser capture → first render callback with the new outline, p95 | 35 ms | 38 ms | 35 ms |
| Generated image → first render callback with the new outline, p95 | 84 ms | 88 ms | 92 ms |
| Age since browser capture across callbacks with an outline, p95 | 82 ms | 84 ms | 70 ms |
| Age since image generation across callbacks with an outline, p95 | 122 ms | 124 ms | 117 ms |
| Gap between successive fresh, nonempty outlines, p95 / longest | 68 / 99 ms | 116 / 268 ms | 68 / 117 ms |
| Results with zero / one / two hands for one pictured hand | 0 / 179 / 0 | 20 / 281 / 54 | 4 / 179 / 29 |
| Render callbacks with a blank overlay | 0 / 707 | 84 / 1,404 | 15 / 698 |

**How far behind the preview?** In a separate 15 Hz run, a small frame number embedded in the generated video identified the image available in the video element at each render callback. The server decoded the same number from each input JPEG. Comparing those two source images while an outline was visible gave a p95 time difference of 67 ms slow and 68 ms fast. The corresponding p95 horizontal displacement was 8 and 74 input pixels. This measures how far the pictured hand moved between images. Fingertip localization accuracy and physical display scanout need separate measurements.

**Why a freeze feels worse.** The browser clears an empty result immediately. At 15 Hz even one miss can leave about 133 ms between fresh outlines. There was also a different kind of stall in one of the two fast runs. On the same frame, copying the video took 9 ms, the JPEG callback took another 107 ms, and send-to-result took 74 ms, including 59 ms in the landmarker. The first render callback came at 200 ms. The other fast run peaked at 41 ms from capture to first callback. These timings locate the stall but do not establish whether CPU scheduling, garbage collection, the encoder, or another process triggered it.

## Where one frame spends its time

Warm fast runs at the stock 15 Hz, pooled by frame. Browser values use a millisecond-resolution clock. A zero means the markers landed in the same clock tick. Server values use a monotonic nanosecond clock. Each percentile is taken over matching observations of that stage. The totals are measured directly.

| Stage | Median | p95 |
| --- | ---: | ---: |
| Source image generated → available image sampled by the app | 28 ms | 60 ms |
| Canvas copies the video image | 0 ms | 1 ms |
| End of copy → JPEG callback | 1 ms | 2 ms |
| JPEG callback → framed Blob ready to send | 0 ms | 0 ms |
| Browser WebSocket send → browser result handler | 18 ms | 22 ms |
| ↳ Server parses the header, checks fields and slices the JPEG | 0.06 ms | 0.09 ms |
| ↳ Stream checks and dispatch to a worker | 0.08 ms | 0.13 ms |
| ↳ Pillow validates and decodes to RGB | 0.84 ms | 1.04 ms |
| ↳ Prepare NumPy pixels and the MediaPipe image | 0.27 ms | 0.37 ms |
| ↳ Synchronous MediaPipe VIDEO call including Python binding result conversion | 15.62 ms | 19.43 ms |
| ↳ Validate and round normalized landmarks for the response | 0.04 ms | 0.07 ms |
| ↳ Worker completion → event loop ready to send | 0.12 ms | 0.20 ms |
| ↳ Service JSON serialization and awaited send | 0.09 ms | 0.14 ms |
| Server frame parse start → send completion, measured together | 17.34 ms | 21.22 ms |
| Time in browser round trip outside that measured server interval | 0.73 ms | 1.74 ms |
| Browser parses and validates result JSON | 0 ms | 0 ms |
| Browser issues outline drawing commands for a nonempty result | 0 ms | 1 ms |
| Drawing commands complete → next render callback | 9 ms | 16 ms |

The round-trip remainder includes Firefox, Vite, TCP, WebSocket framing, event delivery and any waiting before the server starts parsing. It comes from subtracting two **durations for the same frame**. Browser and server clock readings cannot be subtracted directly. Canvas drawing measures command submission. Compositing, physical refresh and the camera sensor are outside these timings. [Browser packet and response handling](../Web%20App/src/utils/protocol.ts) · [Service frame validation](../CVService/src/api/v1/protocol.py) · [Worker and send path](../CVService/src/api/v1/websocket.py) · [Landmarker adapter](../CVService/src/tracking.py)

## Browser capture, scheduling and rendering

| Potential bottleneck | Evidence and consequence |
| --- | --- |
| Camera exposure, driver buffering and video delivery | The app requests ideal width and height, leaving the actual resolution, camera FPS and exposure to the device. The capture timestamp is taken just before copying from the video element. Every millisecond already spent exposing, buffering or presenting that image is invisible to the app’s age check. Even the sharp 30 Hz generated source was 60 ms old at capture at fast-motion p95. Real low light, an external camera, or browser-specific buffering can add delay and blur. |
| Sampling by timer | The timer runs on the main thread, independently of new camera frames. At stock speed only 355 distinct source images from a span of 709 generated images were sent in the two fast runs. The app skips an unready video or an unchanged `video.currentTime` and waits until another capture opportunity. A changing playback clock can also select identical pixels twice. At 18 Hz, 212 completed packets contained just 194 distinct source frame numbers. |
| One outstanding frame | The next capture is scheduled after a matching result. The timer subtracts time already spent since the last capture began. The start-to-start interval is approximately the greater of 66.7 ms and capture + encode + round trip + result handling, plus scheduling jitter. A longer transaction immediately reduces sampling frequency. This also keeps old work from accumulating in an application queue. |
| Resize and JPEG encode | The capture canvas is reused. A high-resolution source can still cost more to copy or downscale. Both dimensions must fit 640×480, so a 16:9 source typically sends 640×360 and a portrait image has fewer horizontal pixels. Small or distant fingers can lose detail. JPEG quality is 0.75. An encoder callback can be delayed by the browser even when its usual cost is small. |
| Overlay and display | The hook draws through refs directly on each result. Each hand costs one palm, five finger chains and 21 dots. The backing canvas is resized only when dimensions change. Between results there is no estimation of movement. An empty or rejected result clears the canvas, and data older than 200 ms at receipt is discarded. A timer clears a displayed sample at its expiry, subject to main-thread scheduling. The 200 ms setting is a freshness cutoff. Raising it can leave an inaccurate outline visible longer. |
| Browser load | In the two fast runs, p95 render-callback spacing was 18 ms, with one 90 ms interval. GPU compositing, display scaling, other tabs, main-thread work, GC and power saving can increase this on a device. The measured page has no 3D scene. A future renderer will share browser resources even if inference runs elsewhere. |

## Transport, service and capacity

The browser checks HTTP health once per connection attempt, then uses one persistent native WebSocket. The Vite dev proxy attaches the key during the upgrade. Each sample is one binary message containing a four-byte header length, a bounded JSON header and JPEG bytes. The response is compact text JSON. The standard launcher disables WebSocket compression, bounds the receive queue to one and caps message size at 263,172 bytes. [Wire contract](streaming-protocol.md) · [Vite proxy](../Web%20App/vite.config.ts) · [Uvicorn launcher](../CVService/src/__main__.py)

| Loopback control, pre-encoded JPEGs | Send-to-result median | p95 | Longest |
| --- | ---: | ---: | ---: |
| v1 direct, validate and decode, then acknowledge | 3.9 ms | 4.8 ms | 5.3 ms |
| v1 through Vite | 4.3 ms | 5.4 ms | 7.2 ms |
| v2 direct, decode and track | 21.2 ms | 27.0 ms | 29.4 ms |
| v2 through Vite | 20.8 ms | 25.9 ms | 29.0 ms |
| v2 through Vite, four concurrent clients, range per client | 17.3–18.5 ms | 22.9–24.0 ms | 80.8–95.3 ms |

- **Bandwidth and network distance.** Stock fast-motion packets had a median of 19,571 bytes including the application header, or about 2.33–2.37 Mbit/s upstream. Replies took 0.086–0.089 Mbit/s. Their median was 672 bytes and p95 was 1,243 bytes. At a 5 Mbit/s uplink the median request alone takes about 31 ms to transmit, or 78 ms at 2 Mbit/s, before propagation or processing. A JPEG at the 256 KiB limit would take about 419 ms at 5 Mbit/s. These are serialization estimates. A detailed or noisy background can produce larger JPEGs than this fixture. The service waits for the complete message. TCP retransmissions hold up later bytes, and Wi-Fi contention, remote RTT, socket buffers and slow consumers can add delay. The app checks `bufferedAmount` before sending, but downstream queues are outside that check. Only loopback was measured.
- **Proxy and response format.** Both direct and proxied v2 p95s landed around 26–27 ms in the pre-encoded control. The single-browser run also left under 2 ms at p95 outside the measured server interval. Those results put little priority on bypassing the authenticated proxy, shrinking landmark JSON, or replacing WebSockets for local use. A remote deployment needs its own measurements.
- **Validation, memory copies and decoding.** Each legal frame goes through UTF-8/JSON validation, a JPEG byte slice, Pillow decoding and RGB conversion, NumPy conversion and MediaPipe image creation. A 640×480 RGB image occupies 921,600 bytes before additional buffers. Repeated allocations and memory pressure can matter with more streams, larger source video or a slower CPU. The measured worker decodes each JPEG once. OpenCV is installed as a dependency. This request path uses Pillow and MediaPipe. [Frame decoder](../CVService/src/api/v1/protocol.py) · [Tracking adapter](../CVService/src/tracking.py)
- **Inference and reacquisition.** Each stream reuses its own VIDEO landmarker. MediaPipe’s presence and bounding-box overlap thresholds default to 0.5. Large jumps, reversals, occlusion and blur can make tracking harder and trigger palm detection again. The upstream graph also uses the maximum hand count to decide when previously tracked hands are sufficient to skip palm detection. This is a plausible explanation for some timing changes. The benchmarks measured the whole call and hand counts, without tracing the internal detector branch. Python’s binding also constructs handedness and world-landmark objects before the app selects normalized landmarks. [MediaPipe options](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Python) · [Upstream tracking graph](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/hand_landmarker/hand_landmarker_graph.cc#L260-L303)
- **Timing of temporal tracking.** The service checks that incoming capture times increase, then gives MediaPipe its own monotonic timestamp when the worker starts detection. Irregular capture, encoding or network delay can therefore change the apparent spacing of frames at inference. The browser can drop a late result after the service has already spent time on it. The v2 result carries frame and stream IDs and landmarks. Distinguishing time in transit from time at the model requires correlated measurements on each end. [Timestamp assignment](../CVService/src/tracking.py) · [Result contract](streaming-protocol.md)
- **Scheduling and concurrency.** The route runs blocking work with `asyncio.to_thread`, serially per stream. Across four admitted streams, model instances, decoder memory, the thread pool and native inference threads compete for CPU and memory bandwidth. In the four-client control the service averaged 100% of one core and peaked at 303 MiB RSS. A single proxied v2 client averaged 29% and peaked at 139 MiB. Four clients each achieved about 14.4 Hz, but their worst frames took 81–95 ms. Their favorable medians do not establish extra sustainable capacity. Clock frequency, thermal state and other processes were uncontrolled. In the main fast browser runs, CVService averaged 25–27%, the Firefox process tree 20–21%, and Vite below 1% of one core. Firefox’s summed peak RSS ranged from 689 to 1,494 MiB across those two sessions and can count shared pages more than once. [Admission](../CVService/src/main.py) · [Worker lifecycle and rate limits](../CVService/src/api/v1/websocket.py)
- **Start, reconnect and outages.** A new stream reads and hashes the 7.82 MB model and creates a tracker. Isolated setup took 186 ms on the first construction in the process and around 19–23 ms on subsequent two-hand constructions. The first browser run took 390 ms from Start to first outline with a generated camera. Hiding the tab, an unexpected disconnect or backpressure can require another health check, socket and tracker. The client uses jittered backoff on recoverable disconnects. Three consecutive rejected JPEGs end camera use. The 2 s frame deadlines, 500 ms server send deadline and 20 s idle timeout govern failure handling. An already-running native call can retain its capacity slot during cleanup. These paths explain interruptions observed alongside status changes. [Lifecycle and deadlines](streaming-protocol.md) · [Model loading](../CVService/src/model.py)

## Which changes helped in controlled experiments?

**Capture rate.** Raising only the benchmark cadence from 15 to 18 Hz reduced p95 age since browser capture from 84 to 70 ms and the p95 gap between fresh outlines from 116 to 68 ms. Source-image age across display callbacks improved less, from 124 to 117 ms. Several packets repeated a source image and upload rose to 2.84 Mbit/s. The service enforces 20 application messages/s per socket with a burst of four, including stream controls. A 30 Hz client can hit a fatal rate-limit error. Any higher rate needs a coordinated capacity and protocol decision.

**Maximum hands.** Isolated adapter trials used the same timestamp-paced inputs with a fresh tracker per condition. Each row has 136 warm frames. “Tracking” includes pixel preparation, the model call and conversion to the response. The browser and network are outside this table.

| Input / maximum hands | Tracking median / p95 | Results with zero / one / two hands |
| --- | ---: | ---: |
| Slow single hand / 2 (current) | 20.0 / 23.4 ms | 0 / 136 / 0 |
| Slow single hand / 1 | 13.6 / 15.5 ms | 0 / 136 / 0 |
| Fast single hand / 2 (current) | 21.8 / 30.0 ms | 8 / 96 / 32 |
| Fast single hand / 1 | 13.7 / 26.6 ms | 36 / 100 / 0 |
| Two pictured hands / 2 | 20.2 / 22.8 ms | 0 / 6 / 130 |
| Blank scene / 2 | 18.1 / 19.2 ms | 136 / 0 / 0 |

A one-hand limit saved 6–8 ms at the median. It also raised fast-motion misses from 8 to 36 and would remove an existing capability. An empty result still consumed substantial inference time. Reacquisition quality and two-hand behavior belong in the acceptance criteria for model tuning.

**Resolution, JPEG quality and blur.** A second pair of adapter trials changed one variable at a time on the same fast trajectory with the current two-hand setting. The synthetic blur averaged nine hand positions across a 1/30 s exposure. Each row has 136 warm frames.

| Input | Median JPEG bytes | Decode p95 | Tracking p95 | Results with zero / one / two hands |
| --- | ---: | ---: | ---: | ---: |
| 640×480, quality 75 | 19,139 | 2.24 ms | 29.78 ms | 8 / 96 / 32 |
| 320×240, quality 75 | 4,559 | 1.11 ms | 31.31 ms | 12 / 98 / 26 |
| 640×480, quality 50 | 13,415 | 2.20 ms | 30.10 ms | 4 / 98 / 34 |
| 640×480, quality 75, synthetic blur | 11,674 | 2.17 ms | 32.14 ms | 30 / 98 / 8 |

Halving each dimension saved 76% of the bytes and about 1 ms of decode time at p95. Tracking p95 stayed around 30 ms. Lower JPEG quality saved 30% of the bytes with a similar model time on this image. Blur produced *smaller* messages while almost quadrupling empty results. A fast socket and a small payload can coexist with a visibly unreliable outline.

## What to measure or change first

1. **Verify the capture cadence on target devices.** Compare the new video callback scheduler with the original timer at equal image quality. Count distinct input images, fresh-outline gaps, source age and two-hand correctness. A camera delivering 12 FPS can supply up to 12 distinct observations/s. [Video frame callback metadata](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
2. **Measure acquisition and loss on the affected device.** Record the camera’s actual track settings, browser, lighting and display refresh. Repeat slow motion, fast sweeps, reversals, two hands and a hand leaving the frame in bright and dim light. Measure p50/p95/p99 capture-to-first-render, age across display callbacks, blank time, false extra hands and reacquisition time. Use a consented externally timed motion/display reference for physical motion-to-photon latency. This run’s p95 of 38 ms covers only the part after the browser samples the video. The project’s initial local p95 target is under 100 ms from sample to visible response. [Project targets](../AGENTS.md)
3. **Tune the stage that dominates on that device.** If v1 and v2 both slow down as JPEG bytes grow, compare image quality, dimensions and network conditions. If only v2 slows down or misses spike, compare model settings on identical frames, including blur, with one and two hands present. To isolate model error, score the wrist and index fingertip against their annotated positions on the exact submitted frame. If those positions match and the live outline trails, compare preview-frame age and sampling cadence. Any display-side prediction should be evaluated for overshoot at reversals, clear immediately on loss, and handle the absence of persistent hand IDs. Additional smoothing can introduce delay.
4. **Check tails under representative load.** Repeat the winning configuration on the supported browser and hardware, on the expected network and during a sustained session. Include one and four clients, actual CPU and memory use, render frame times and the effect of competing work. Compare equal-length runs with matched content. Keep bounded queues, per-stream trackers, validation and the loss timeout while evaluating changes.

## Measurement and reproduction

- **Host.** Apple MacBook Neo (`Mac17,5`), A18 Pro, two performance and four efficiency cores, 8 GB memory, macOS 26.6.2. Headless Firefox 160.0.1, Node 24.20.0, Vite 8.3.8, Python 3.14.10, FastAPI 0.163.1, Uvicorn 0.54.0, websockets 17.4, Pillow 13.0.0, NumPy 2.5.4 and MediaPipe 1.2.3. The inference runtime reported XNNPACK CPU. The installed `annotated-doc` was 0.0.7 versus 0.0.6 in the Windows lock. Measurements used the existing environment and the verified float16 v1 model. [Pinned model and SHA-256](../CVService/src/model.py) · [Dependency lock](../CVService/requirements.lock)
- **Browser inputs.** A generated 640×480 track requested 30 FPS. It translated one sharp public hand photograph, 266×279 pixels, horizontally along a repeating triangular path at 120 or 1,100 px/s. A strip outside the hand encoded the generated frame number. The real app captured the video, sent JPEGs through its authenticated Vite proxy on isolated loopback ports and drew the returned landmarks. Temporary probes correlated stream ID, frame ID and source number. The preview comparison used a separate run so reading a small video strip each refresh did not affect the main timings. [Public fixture and checksum](../tests/fixtures/README.md)
- **Timing and denominators.** Each browser condition ran for about 12 warm seconds after excluding the first 12 frames. Slow and 18 Hz were run once. Fast 15 Hz was repeated on either side of the 18 Hz trial. Nearest-rank percentiles pool individual observations. Frame turnaround includes only frames that produced a drawn outline where applicable. Age across display callbacks weights by how long an outline remained visible, with blank callbacks counted separately. Browser `performance.now()` covers capture, source generation and render callbacks. Python `perf_counter_ns()` covers server stages. Sub-millisecond probe overhead, timer precision and headless scheduling limit precision.
- **Control runs.** The wire comparison used pre-encoded 640×480 JPEGs and an independent Python WebSocket client after Firefox exited. Each session had 11 warm-up packets and 100 measured responses, aimed at 15 Hz with one request in flight. Four independent sessions started together for the capacity comparison. The adapter experiments used 76 frames per condition at 15 Hz, discarded the first eight, and repeated in reverse condition order. Browser-generated and offline JPEGs, pacing and process load differ between experiments.
- **Quick reproduction in the repository.** Start the two services as documented and open the **live camera fixture** from the README. Its generated track exercises the real service. The default mock mode deliberately adds 80 ms and generates its own joints. For comparable numbers, reproduce the speeds, sizes, warm-up and frame markers above, place browser timing marks around copy, encode, send, receive, draw and the next rendering callback, and collect server stage durations by matching frame ID and stream ID. The stock live fixture uses a different trajectory and resolution. [Setup and live fixture](../README.md#verification) · [Fixture implementation](../Web%20App/tests/browser-harness.ts)

The benchmarks exercised real inference and local WebSocket traffic with synthetic video. Physical camera latency, other devices and browsers, remote networks, sustained thermal behavior and 3D rendering remain unmeasured.
