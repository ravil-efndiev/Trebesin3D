import { config } from "./config.ts";
import type { CapturedFrame, ScheduleFrame } from "./types.ts";

export const stopMediaTracks = (stream: MediaStream | null): void => {
  stream?.getTracks().forEach((track) => track.stop());
};

export const getCaptureSize = (width: number, height: number) => {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("Camera dimensions must be positive integers.");
  }

  const scale = Math.min(1, config.maxFrameWidth / width, config.maxFrameHeight / height);

  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
};

export const createFrameScheduler = (getVideo: () => HTMLVideoElement | null): ScheduleFrame => {
  let useTimer = false;
  let lastMediaTime: number | undefined;

  return (notBeforeMs, onFrame) => {
    const video = getVideo();
    if (useTimer || !video?.requestVideoFrameCallback || !video.cancelVideoFrameCallback) return;

    let settled = false;
    const onVideoFrame: VideoFrameRequestCallback = (now, { mediaTime }) => {
      if (settled) return;
      if (now < notBeforeMs || !Number.isFinite(mediaTime) || mediaTime === lastMediaTime) {
        callbackId = video.requestVideoFrameCallback(onVideoFrame);
        return;
      }

      settled = true;
      clearTimeout(fallbackTimer);
      lastMediaTime = mediaTime;
      onFrame(mediaTime);
    };
    let callbackId = video.requestVideoFrameCallback(onVideoFrame);
    const cancel = () => {
      if (settled) return;

      settled = true;
      clearTimeout(fallbackTimer);
      video.cancelVideoFrameCallback(callbackId);
    };
    const fallbackTimer = setTimeout(() => {
      cancel();
      // Stay on the timer for this camera session if presentation callbacks stall.
      useTimer = true;
      onFrame();
    }, Math.max(0, notBeforeMs - performance.now()) + config.videoFrameCallbackTimeoutMs);

    return cancel;
  };
};

export const createFrameCapture = (getVideo: () => HTMLVideoElement | null) => {
  let canvas: HTMLCanvasElement | null = null;
  let lastVideoTime = -1;

  return async (signal: AbortSignal, mediaTime?: number): Promise<CapturedFrame | null> => {
    const video = getVideo();
    if (signal.aborted || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const frameTime = mediaTime ?? video.currentTime;
    if (frameTime === lastVideoTime) return null;

    canvas ??= document.createElement("canvas");
    const { width, height } = getCaptureSize(video.videoWidth, video.videoHeight);

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) throw new Error("Canvas capture is unavailable.");

    const capturedAtMs = performance.now();
    context.drawImage(video, 0, 0, width, height);
    lastVideoTime = frameTime;

    const jpeg = await new Promise<Blob>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("Capture cancelled.", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        canvas!.toBlob((blob) => {
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted) return;
          if (blob) resolve(blob);
          else reject(new Error("JPEG encoding failed."));
        }, "image/jpeg", 0.75);
      } catch (error) {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    });

    return { jpeg, width, height, capturedAtMs };
  };
};
