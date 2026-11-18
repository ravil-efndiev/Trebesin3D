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
  protocolVersion: 1;
  streamId: string;
  frameId: number;
  capturedAtMs: number;
  width: number;
  height: number;
  mimeType: "image/jpeg";
}

export type ServerMessage =
  | { type: "stream:started"; requestId: string; protocolVersion: 1; streamId: string }
  | { type: "stream:stopped"; requestId: string; streamId: string }
  | { type: "frame:ack"; streamId: string; frameId: number }
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

export interface StreamOptions {
  url: string;
  capture: (signal: AbortSignal) => Promise<CapturedFrame | null>;
  onStatus: (status: StreamStatus) => void;
  createSocket?: (url: string) => StreamSocket;
  checkHealth?: (signal: AbortSignal) => Promise<void>;
}
