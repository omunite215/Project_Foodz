/*
 * The document viewer's geometry (F6 design 9): three zoom levels, quarter turns, and a pan
 * that never lets the image leave the canvas.
 */

export const ZOOM_LEVELS = [1, 2, 3] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];

export const zoomIn = (zoom: Zoom): Zoom => (zoom === 1 ? 2 : 3);
export const zoomOut = (zoom: Zoom): Zoom => (zoom === 3 ? 2 : 1);

export const rotateQuarter = (degrees: number) => (degrees + 90) % 360;

export const zoomText = (zoom: Zoom) => `${zoom * 100}%`;

/** Arrow keys move 40 px, 120 px with Shift. */
export const panStep = (shift: boolean) => (shift ? 120 : 40);

export interface Size {
  width: number;
  height: number;
}

/** The image's size when it fits the canvas at 100%, with a quarter turn swapping its sides. */
export function fittedSize(natural: Size, canvas: Size, degrees: number): Size {
  if (natural.width <= 0 || natural.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return { width: 0, height: 0 };
  }
  const turned = degrees % 180 !== 0;
  const width = turned ? natural.height : natural.width;
  const height = turned ? natural.width : natural.height;
  const scale = Math.min(canvas.width / width, canvas.height / height);
  return { width: width * scale, height: height * scale };
}

/** Keeps the pan inside the image's edges at this zoom; at 100% nothing moves. */
export function clampPan(
  pan: { x: number; y: number },
  fitted: Size,
  canvas: Size,
  zoom: Zoom,
): { x: number; y: number } {
  const maxX = Math.max(0, (fitted.width * zoom - canvas.width) / 2);
  const maxY = Math.max(0, (fitted.height * zoom - canvas.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}

/** A signed link is renewed when less than 30 seconds of it are left (A21.4). */
export const needsFreshLink = (expiresAt: string | null, now: number) =>
  !expiresAt || Date.parse(expiresAt) - now < 30_000;
