// Runs only in the synthetic camera fixture. No camera permission or service is required.
import { _roots } from "@react-three/fiber";
import { galleryLayout } from "../src/scene/projects.ts";
import type { Gesture } from "../src/utils/gestures.ts";

const until = async (condition: () => boolean, description: string) => {
  const deadline = performance.now() + 10000;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(description);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

export const checkScene = async (tip: number[], showHand: (visible: boolean) => void, pose: (gesture: Gesture) => void, tracks: MediaStreamTrack[]) => {
  const report = document.querySelector<HTMLOutputElement>("#scene-check")!;
  const cameraButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Camera streaming"] button'))
    .find((button) => /^(Start|Stop) camera$/.test(button.textContent.trim()));
  const project = () => document.querySelector("#project-name")?.textContent;
  const pinned = () => Boolean(document.querySelector('[aria-label="Clear project selection"]'));
  try {
    await until(() => Boolean(document.querySelector('[aria-label="3D project gallery"] canvas') && cameraButton()), "Gallery did not mount");
    if (tracks.length) throw new Error("Camera was requested before Start");
    const portrait = innerWidth <= innerHeight;
    // These points are inside the pavilion at the home view on the desktop and phone test sizes.
    tip[0] = portrait ? 0.71 : 0.62;
    tip[1] = portrait ? 0.64 : 0.57;
    cameraButton()!.click();

    await until(() => project() === "Helix Pavilion" && !pinned(), "Pointing did not reveal the pavilion");
    showHand(false);
    await until(() => !project(), "Empty results did not clear hand hover");
    showHand(true);
    await until(() => project() === "Helix Pavilion", "Hover did not recover");
    const pointingY = tip[1];
    pose("idle");
    tip[1] = 0.98;
    await until(() => !project(), "Intermediate bend did not stop pointer hover");
    pose("select");
    await until(pinned, "Index bend did not select the pavilion");
    if (new URLSearchParams(location.search).get("debug") === "select") {
      const debug = () => document.querySelector('[aria-label="Select debug"]')?.textContent ?? "";
      await until(() => debug().includes("Received from CVService: 1") && debug().includes("Picked Helix Pavilion"), "Select debug did not record receipt and pick");
    }
    showHand(false);
    tip[1] = pointingY;
    await until(() => cameraButton()?.parentElement?.textContent?.includes("0 hands") === true, "Missing empty-hand result");
    if (!pinned() || project() !== "Helix Pavilion") throw new Error("Selection disappeared after release");
    document.querySelector<HTMLButtonElement>('[aria-label="Clear project selection"]')!.click();
    await until(() => !project(), "Dismiss did not clear selection");

    const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="3D project gallery"] canvas')!;
    const cameraStatus = () => document.querySelector('[aria-label="Camera streaming"] [role="status"]')?.textContent ?? "";
    showHand(true);
    for (const gesture of ["zoom_in", "rotate_right"] as const) {
      await until(() => project() === "Helix Pavilion", "Home view did not restore the same hand target");
      const camera = _roots.get(canvas)!.store.getState().camera;
      const start = camera.position.clone();
      const { pivot } = galleryLayout(canvas.clientWidth, canvas.clientHeight);
      const radius = () => Math.hypot(camera.position.x - pivot.x, camera.position.z - pivot.z);
      const entranceRadius = radius();
      pose(gesture);
      const zoom = gesture === "zoom_in";
      await until(() => cameraStatus().includes(zoom ? "2 hands · Camera · Zooming in" : "2 hands · Camera · Rotating right"), "Navigation gesture did not reach the camera panel");
      if (zoom) {
        const overlay = document.querySelector<HTMLCanvasElement>('[aria-label="Camera streaming"] canvas')!;
        const context = overlay.getContext("2d")!;
        const wristColor = (x: number) => context.getImageData(Math.floor(x * overlay.width), Math.floor(0.85 * overlay.height), 1, 1).data.slice(0, 3).join(",");
        if (wristColor(0.5) !== "35,121,255" || wristColor(0.21) !== "186,54,230") throw new Error("Missing two-color overlay");
      }
      await new Promise((resolve) => setTimeout(resolve, zoom ? 1450 : 700));
      if (!zoom) {
        if (start.distanceTo(camera.position) < 2 || Math.abs(radius() - entranceRadius) > 0.01) {
          throw new Error("Overview turn did not move the camera around the entrance pivot");
        }
      }
      pose("cursor");
      await until(() => cameraStatus().includes("2 hands · Cursor"), "Did not return to cursor mode");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (project() === "Helix Pavilion") throw new Error(gesture + " left the original target under the cursor");
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    }
    await until(() => project() === "Helix Pavilion", "Reset after turning did not restore the pavilion");
    cameraButton()!.click();
    await until(() => tracks.length > 0 && tracks.every((track) => track.readyState === "ended"), "Stop did not release the tracks");
    report.value = "PASS · hover, loss, selection, dual-color zoom, turning, view reset and camera cleanup";
  } catch (error) {
    if (cameraButton()?.textContent?.includes("Stop camera")) cameraButton()!.click();
    report.value = "FAIL · " + String(error);
  }
};
