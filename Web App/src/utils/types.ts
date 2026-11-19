export interface StreamStatus {
  phase: "idle" | "camera" | "checking" | "connecting" | "starting" | "streaming" | "reconnecting" | "paused" | "error";
  message: string;
}

export interface CapturedFrame {
  jpeg: Blob;
  width: number;
  height: number;
  capturedAtMs: number;
}

export interface FrameHeader {
  type: "stream:frame";
  protocolVersion: 2;
  streamId: string;
  frameId: number;
  capturedAtMs: number;
  width: number;
  height: number;
  mimeType: "image/jpeg";
}

export interface HandObservation {
  landmarks: [number, number, number][];
}

export interface TrackingSample {
  hands: HandObservation[];
  width: number;
  height: number;
}

export type ServerMessage =
  | { type: "stream:started"; requestId: string; protocolVersion: 2; streamId: string }
  | { type: "stream:stopped"; requestId: string; streamId: string }
  | { type: "tracking:result"; streamId: string; frameId: number; hands: HandObservation[] }
  | {
      type: "stream:error";
      code: string;
      message: string;
      fatal: boolean;
      requestId?: string;
      streamId?: string;
      frameId?: number;
    };

export interface StreamSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send: (data: string | Blob) => void;
  close: (code?: number, reason?: string) => void;
}

export type ScheduleFrame = (notBeforeMs: number, onFrame: (mediaTime?: number) => void) => (() => void) | undefined;

export interface StreamOptions {
  url: string;
  capture: (signal: AbortSignal, mediaTime?: number) => Promise<CapturedFrame | null>;
  scheduleFrame?: ScheduleFrame;
  onStatus: (status: StreamStatus) => void;
  onTracking?: (sample: TrackingSample | null) => void;
  createSocket?: (url: string) => StreamSocket;
  checkHealth?: (signal: AbortSignal) => Promise<void>;
}
