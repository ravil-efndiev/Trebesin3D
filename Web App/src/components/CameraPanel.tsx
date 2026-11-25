import { useCallback, useState } from "react";
import CameraView from "./CameraView.tsx";
import type { SelectReceipt, StreamOptions } from "../utils/types.ts";

interface Props {
  onTracking: StreamOptions["onTracking"];
  selectDebug: boolean;
  pickStatus: string;
  onPickStatus: (status: string) => void;
}

const receiptLabels = {
  fresh: "Fresh result",
  expired: "Frame expired before arrival",
  unmatched: "Result did not match the active frame",
} as const;

const CameraPanel = ({ onTracking, selectDebug, pickStatus, onPickStatus }: Props) => {
  const [receipt, setReceipt] = useState<(SelectReceipt & { count: number; time: string }) | null>(null);
  const reportReceipt = useCallback((next: SelectReceipt) => {
    const time = new Date().toLocaleTimeString();
    setReceipt((previous) => ({ ...next, time, count: (previous?.count ?? 0) + 1 }));
    onPickStatus("Waiting for scene");
  }, [onPickStatus]);

  return (
    <>
      <CameraView onTracking={ onTracking } onSelectReceipt={ selectDebug ? reportReceipt : undefined } />
      { selectDebug && (
        <section aria-label="Select debug" className="rounded-[4px] border border-edge bg-panel px-3 py-2.5 text-xs text-muted">
          <h2 className="font-semibold text-ice">Select debug</h2>
          <div role="status" className="mt-1 space-y-1 font-mono">
            <p>Received from CVService: { receipt?.count ?? 0 }</p>
            { receipt ? (
              <>
                <p>Last select at { receipt.time } · Frame { receipt.frameId }</p>
                <p>{ receiptLabels[receipt.status] }</p>
                { receipt.status === "fresh" && <p>{ pickStatus }</p> }
              </>
            ) : <p>Waiting for a select event</p> }
          </div>
        </section>
      ) }
    </>
  );
};

export default CameraPanel;
