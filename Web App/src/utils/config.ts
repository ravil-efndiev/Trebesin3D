export const config = {
  defaultApiUrl: "http://localhost:8000/api",
  defaultStreamUrl: "ws://localhost:8000/api/v1/stream",
  frameIntervalMs: 1000 / 15,
  frameTimeoutMs: 2000,
  connectionTimeoutMs: 3000,
  mediaReadyTimeoutMs: 15000,
  maxFrameWidth: 640,
  maxFrameHeight: 480,
  maxJpegBytes: 256 * 1024,
  maxHeaderBytes: 1024,
  maxResponseBytes: 4096,
  maxRetries: 5,
} as const;
