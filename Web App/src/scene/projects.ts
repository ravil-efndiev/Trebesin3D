export const projects = [
  { id: "slotMachine", model: { url: new URL("../assets/projectModels/esp-slot-machine.glb", import.meta.url).href, span: 3.7 }, name: "ESP Slot Machine", field: "Electronics", collection: "Personal project", description: "Functional slot machine made on ESP and Arduino microcontrollers", externalLink: "*insert online slot machine web app when deployed*" },
  { id: "albiLab", model: { url: new URL("../assets/projectModels/albi-lab.glb", import.meta.url).href, span: 3.4 }, name: "Albi Lab", field: "3D design", collection: "Personal project", description: "A smart plant-growing station with sensors that monitor environmental conditions and automatically control watering and lighting." },
  { id: "omnicar", model: { url: new URL("../assets/projectModels/omnicar-gallery.glb", import.meta.url).href, span: 4.1 }, name: "Omni-Car", field: "Robotics", collection: "School project", description: "A four-wheel robot with mecanum wheels and ultrasonic sensors." },
] as const;

export type ProjectId = typeof projects[number]["id"];
export const homeDepth = 22;
export const fieldOfView = 48;
export const hall = { halfWidth: 36, halfDepth: 48, height: 25, clearance: 1.7 };

export const galleryLayout = (width: number, height: number) => {
  const portrait = width <= height;
  const rail = width < 640 ? Math.min(224, Math.max(152, width * 0.41)) + 12 : Math.min(256, Math.max(192, width * 0.19)) + 24;
  const space = (width - rail - 8) / width;
  // Composition is specified at the home view. Each object occupies a distinct depth plane.
  const place = (u: number, v: number, z: number, widthShare: number, heightShare: number, span: number) => {
    const worldHeight = 2 * (homeDepth - z) * Math.tan(fieldOfView * Math.PI / 360);
    const unitsPerPixel = worldHeight / height;
    return {
      x: Math.max(-hall.halfWidth + 5, Math.min(hall.halfWidth - 5, (u - 0.5) * width * unitsPerPixel)),
      y: (0.5 - v) * worldHeight,
      z,
      scale: Math.min(width * widthShare, height * heightShare) * unitsPerPixel / span,
    };
  };

  const slotMachine = portrait ? place(0.29, 0.64, 6.5, 0.45, 0.31, 3.7) : place(0.48 * space, 0.58, 6.5, 0.27 * space, 0.40, 3.7);
  const albiLab = portrait ? place(0.20, 0.30, -7, 0.27, 0.18, 3.4) : place(0.105 * space, 0.35, -7, 0.17 * space, 0.23, 3.4);
  const omnicar = portrait ? place(0.79, 0.78, -23, 0.30, 0.22, 4.1) : place(0.90 * space, 0.51, -23, 0.155 * space, 0.25, 4.1);
  const floor = Math.min(slotMachine.y - 1.2 * slotMachine.scale, omnicar.y - 1.25 * omnicar.scale, albiLab.y - 1.7 * albiLab.scale, -3.5) - 2.2;
  const pivot = { x: (slotMachine.x + albiLab.x + omnicar.x) / 3, z: (slotMachine.z + albiLab.z + omnicar.z) / 3 };
  return { slotMachine, albiLab, omnicar, floor, pivot };
};
