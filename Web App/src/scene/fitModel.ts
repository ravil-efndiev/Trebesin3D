import { Box3, Group, Vector3, type Object3D } from "three";

// Keep the cached scene and its materials reusable across exhibit instances.
export const fitModel = (scene: Object3D, span: number) => {
  const model = scene.clone();
  const bounds = new Box3().setFromObject(model, true);
  const size = bounds.getSize(new Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (!(extent > 0 && Number.isFinite(extent))) throw new Error("Project model has no usable bounds.");

  const centered = new Group();
  centered.add(model);
  centered.position.copy(bounds.getCenter(new Vector3())).negate();
  const fitted = new Group();
  fitted.add(centered);
  fitted.scale.setScalar(span / extent);
  return fitted;
};
