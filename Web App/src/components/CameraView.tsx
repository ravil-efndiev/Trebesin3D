import { Camera, CameraOff, Video, VideoOff } from "lucide-react";
import Webcam from "react-webcam";
import { useCameraStream } from "../hooks/useCameraStream.ts";
import { config } from "../utils/config.ts";
import type { StreamOptions } from "../utils/types.ts";
import { useRef, useState } from "react";
import useClickAwayListener from "../hooks/useClickAwayListener.ts";
import { validateStreamUrl } from "../utils/protocol.ts";

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const streamUrl = import.meta.env.VITE_CV_STREAM_URL || `${socketProtocol}//${window.location.host}${config.streamPath}`;
const videoConstraints = {
  width: { ideal: config.maxFrameWidth },
  height: { ideal: config.maxFrameHeight },
};

interface Props {
  onTracking: StreamOptions["onTracking"];
  onSelectReceipt?: StreamOptions["onSelectReceipt"];
}

const CameraView = ({ onTracking, onSelectReceipt }: Props) => {
  const { webcamRef, overlayRef, enabled, status, gestureText, start, stop, onUserMedia, onUserMediaError } = useCameraStream(streamUrl, onTracking, onSelectReceipt);
  const streaming = status.phase === "streaming";

  const [showUrl, setShowUrl] = useState(false);
  const showUrlButtonRef = useRef<HTMLButtonElement>(null);

  useClickAwayListener(showUrlButtonRef, () => {
    setShowUrl(false);
  });

  const validateAndShowStreamUrl = (urlString: string) => {
    try {
      const url = validateStreamUrl(new URL(urlString), window.location.protocol);
      return url;
    } catch (error) {
      return "The camera stream URL is invalid or insecure.";
    }
  }

  return (
    <section className="overflow-hidden rounded-[4px] border border-edge bg-panel shadow-lg" aria-label="Camera streaming">
      <header className="flex items-center justify-between gap-2 border-b border-edge bg-raised px-3 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Camera size={ 16 } className="text-ice" aria-hidden="true" />Camera</h2>
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
          <i className={ `size-1.5 rounded-full ${streaming ? "bg-ice" : "bg-slate-500"}` } />{ streaming ? "Live" : enabled ? "On" : "Off" }
        </span>
      </header>
      { enabled ? (
        <div className="relative overflow-hidden bg-black">
          <Webcam
            ref={ webcamRef }
            audio={ false }
            mirrored={ true }
            videoConstraints={ videoConstraints }
            onUserMedia={ onUserMedia }
            onUserMediaError={ onUserMediaError }
            className="block h-auto w-full"
            aria-label="Mirrored camera preview"
          />
          <canvas ref={ overlayRef } aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100" />
        </div>
      ) : (
        <div className="flex items-center gap-2.5 bg-[#0b1421] px-3 py-3.5 text-muted">
          <CameraOff size={ 20 } strokeWidth={ 1.4 } aria-hidden="true" className="shrink-0 text-[#839caf]" />
          <p className="text-xs leading-relaxed">
            Starting sends camera frames to CVService. Audio is off.<br />
            <button
             type="button"
              aria-expanded={ showUrl }
              className="text-left text-xs break-all text-muted underline hover:text-white"
              onClick={ () => setShowUrl((prev) => !prev) }
              ref={ showUrlButtonRef }
            >
              { showUrl ? validateAndShowStreamUrl(streamUrl) : "Show URL" }
            </button>
          </p>
        </div>
      ) }
      <div className="space-y-2.5 border-t border-edge px-3 py-3">
        <p role="status" aria-live="polite" className={ status.phase === "idle" ? "sr-only" : "text-xs leading-relaxed text-muted" }>{ status.message }{ streaming && <span className="block text-ice">{ gestureText || "Waiting for tracking…" }</span> }</p>
        <button type="button" onClick={ enabled ? stop : start } className="flex min-h-9 w-full items-center justify-center gap-2 rounded-sm border border-[#465a71] bg-[#203146] px-2 text-sm font-medium whitespace-nowrap text-ice hover:bg-[#2c4159]">
          { enabled ? <VideoOff size={ 15 } aria-hidden="true" /> : <Video size={ 15 } aria-hidden="true" /> }{ enabled ? "Stop camera" : "Start camera" }
        </button>
      </div>
    </section>
  );
};

export default CameraView;
