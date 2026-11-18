import Webcam from "react-webcam";
import { useCameraStream } from "../hooks/useCameraStream.ts";
import { config } from "../utils/config.ts";

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const streamUrl = import.meta.env.VITE_CV_STREAM_URL || `${socketProtocol}//${window.location.host}${config.streamPath}`;
const videoConstraints = {
  width: { ideal: config.maxFrameWidth },
  height: { ideal: config.maxFrameHeight },
};

const CameraView = () => {
  const { webcamRef, overlayRef, enabled, status, start, stop, onUserMedia, onUserMediaError } = useCameraStream(streamUrl);

  return (
    <section className="mt-6 max-w-lg space-y-3" aria-label="Camera streaming">
      <h2 className="text-lg font-semibold">Camera streaming</h2>
      <p>Starting the camera sends JPEG frames to the CV service below. Audio is off; frames are not recorded by this app.</p>
      <p className="break-all text-sm">Service: { streamUrl }</p>
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded bg-violet-600 px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          onClick={ start }
          disabled={ enabled }
        >
          Start camera
        </button>
        <button
          type="button"
          className="rounded border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          onClick={ stop }
          disabled={ !enabled }
        >
          Stop camera
        </button>
      </div>
      <p role="status" aria-live="polite">{ status.message }</p>
      {enabled && (
        <div className="relative overflow-hidden rounded">
          <Webcam
            ref={ webcamRef }
            audio={ false }
            mirrored={ false }
            videoConstraints={ videoConstraints }
            onUserMedia={ onUserMedia }
            onUserMediaError={ onUserMediaError }
            className="block h-auto w-full"
            aria-label="Unmirrored camera preview"
          />
          <canvas ref={ overlayRef } aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>
      )}
    </section>
  );
};

export default CameraView;
