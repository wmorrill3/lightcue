// Tesla xLights channel map (1-based), from the official tesla_xlights_show_folder layout (200-channel config).
// Shared by the engine (Node) and the preview (browser). No imports.

export const CHANNELS = 200;
export const STEP_MS = 20;
export const FPS = 1000 / STEP_MS;

// lights: [left, right] pairs or single channels
export const L = {
  outer: [1, 2], inner: [3, 4], signature: [5, 6],
  ch4: [7, 8], ch5: [9, 10], ch6: [11, 12],
  frontTurn: [13, 14], fog: [15, 16], auxPark: [17, 18], sideMarker: [19, 20], repeater: [21, 22],
  rearTurn: [23, 24], brake: 25, tail: [26, 27], reverse: 28, rearFog: 29, plate: 30,
};

// closures
export const C = {
  falcon: [31, 32], frontDoor: [33, 34], mirror: [35, 36],
  window: [37, 38, 39, 40], // LF, LR, RF, RR
  liftgate: 41, handle: [42, 43, 44, 45], // LF, LR, RF, RR
  chargePort: 46,
};

// Cybertruck light bars + interior RGB
export const BAR = {
  frontLeft: { start: 47, n: 30 }, frontRight: { start: 77, n: 30 },
  rearLeft: { start: 111, n: 26 }, rearRight: { start: 137, n: 26 },
  offroad: { start: 167, n: 6 },
};
export const RGB = { // each is 3 channels R,G,B
  display: 176, rightRear: 179, rightFront: 182, centerFront: 185, leftFront: 188, leftRear: 191,
};

// effect values (xLights brightness → byte, truncated like xLights writes them; verified against Tesla's examples)
export const V = {
  OFF: 0, ON: 255,
  OFF_500: 25, OFF_1000: 51, OFF_2000: 76,
  ON_500: 178, ON_1000: 204, ON_2000: 229,
  OPEN: 63, DANCE: 127, CLOSE: 191, STOP: 255,
};

// per-show actuation limits (Open/Close/Dance count; Idle/Stop don't)
export const LIMITS = { liftgate: 6, mirror: 20, chargePort: 3, window: 6, handle: 20, frontDoor: 6, falcon: 6 };

// approximate movement durations (s)
export const MOVE_S = { liftgateOpen: 14, liftgateClose: 4, frontDoorOpen: 22, frontDoorClose: 3, falconOpen: 20, falconClose: 8, window: 4, mirror: 2, handle: 2, chargePort: 2 };

export const CLOSURE_CHANNELS = (() => {
  const m = {};
  C.falcon.forEach((c) => (m[c] = 'falcon'));
  C.frontDoor.forEach((c) => (m[c] = 'frontDoor'));
  C.mirror.forEach((c) => (m[c] = 'mirror'));
  C.window.forEach((c) => (m[c] = 'window'));
  C.handle.forEach((c) => (m[c] = 'handle'));
  m[C.liftgate] = 'liftgate'; m[C.chargePort] = 'chargePort';
  return m;
})();

// ramp code → { on, ms } (ms 0 = instant)
export function rampOf(v) {
  if (v === 0) return { on: false, ms: 0 };
  if (v <= 37) return { on: false, ms: 500 };
  if (v <= 63) return { on: false, ms: 1000 };
  if (v <= 127) return { on: false, ms: 2000 };
  if (v <= 191) return { on: true, ms: 500 };
  if (v <= 216) return { on: true, ms: 1000 };
  if (v <= 241) return { on: true, ms: 2000 };
  return { on: true, ms: 0 };
}

// closure byte → command
export function closureOf(v) {
  if (v === 0) return 'idle';
  if (v < 96) return 'open';
  if (v < 160) return 'dance';
  if (v < 224) return 'close';
  return 'stop';
}
