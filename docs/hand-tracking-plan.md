# Task 3 · Hand landmark tracking

The deliverable for this session is an opt-in camera preview with a palm and five finger chains drawn from CVService observations. Gesture recognition and scene controls are later features.

| Step | Implementation | Acceptance check |
| --- | --- | --- |
| Define the result | Negotiate v2 on the existing socket. Specify landmark order, coordinates, empty detections, frame matching and expiry. Keep v1 receipts available. | Both clients can start a stream. The v2 parser rejects incomplete hands, extra fields and invalid numbers. |
| Prepare the model | Install the official versioned MediaPipe Hand Landmarker bundle locally and verify its SHA-256 before use. | A clean setup can fetch the model. A missing or damaged model gives a startup error that releases the stream. |
| Track each stream | Admit the socket before allocating its VIDEO tracker. Reuse that tracker, decode each JPEG once, and run synchronous inference in a worker with strictly increasing timestamps. | A translated hand moves by the expected image distance, a blank frame returns an empty list, and restarting creates fresh tracking state. Slow work retains its capacity slot until it exits. |
| Draw the preview | Match each result to the current frame and draw its joints on a transparent canvas aligned with the video. Use the browser capture clock for expiry. | The outline follows the test hand. Empty, rejected, stale or disconnected samples clear it. Resizing the preview preserves alignment. |
| Verify delivery | Run the Python loopback suite, frontend tests, type check and production build. Exercise the Vite proxy, browser capture, service, overlay and Stop together using a moving public test fixture. | Distinguish fixture observations from physical-camera checks and measured performance. |

[Wire format and lifecycle](streaming-protocol.md) · [Setup and browser check](../README.md)
