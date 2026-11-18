import { config } from "./config.ts";
import type { CapturedFrame } from "./types.ts";

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

export const createFrameCapture = (getVideo: () => HTMLVideoElement | null) => {
  let canvas: HTMLCanvasElement | null = null;
  let lastVideoTime = -1;

  return async (signal: AbortSignal): Promise<CapturedFrame | null> => {
    const video = getVideo();

    if (
      signal.aborted || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight
      || video.currentTime === lastVideoTime
    ) {
      return null;
    }

    canvas ??= document.createElement("canvas");
    const { width, height } = getCaptureSize(video.videoWidth, video.videoHeight);

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) throw new Error("Canvas capture is unavailable.");

    const capturedAtMs = performance.now();
    context.drawImage(video, 0, 0, width, height);
    lastVideoTime = video.currentTime;

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
