// Where to draw a mistake's box over a photo. The marker's positions are fractions
// (0 to 1) of the image, measured from the top-left corner, and are only approximate.

export type Box = { x: number; y: number; width: number; height: number };

const PADDING = 0.015;

/** The box grown a little on each side and cut to the image. */
export function padBox(box: Box): Box {
  const left = Math.max(0, box.x - PADDING);
  const top = Math.max(0, box.y - PADDING);
  const right = Math.min(1, box.x + box.width + PADDING);
  const bottom = Math.min(1, box.y + box.height + PADDING);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** CSS for a box placed inside a container the size of the image. */
export function boxStyle(box: Box) {
  const percent = (value: number) => `${Math.round(value * 10000) / 100}%`;
  return {
    left: percent(box.x),
    top: percent(box.y),
    width: percent(box.width),
    height: percent(box.height),
  };
}
