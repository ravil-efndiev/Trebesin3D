import Webcam from "react-webcam";
import { useCameraStream } from "../hooks/useCameraStream.ts";
import { config } from "../utils/config.ts";

const streamUrl = import.meta.env.VITE_CV_STREAM_URL || config.defaultStreamUrl;
const videoConstraints = {
  width: { ideal: config.maxFrameWidth },
  height: { ideal: config.maxFrameHeight },
};

const CameraView = () => {
  const { webcamRef, enabled, status, start, stop, onUserMedia, onUserMediaError } = useCameraStream(streamUrl);

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
        <Webcam
          ref={ webcamRef }
          audio={ false }
          mirrored={ false }
          videoConstraints={ videoConstraints }
          onUserMedia={ onUserMedia }
          onUserMediaError={ onUserMediaError }
          className="w-full rounded"
          aria-label="Unmirrored camera preview"
        />
      )}
    </section>
  );
};

export default CameraView;
