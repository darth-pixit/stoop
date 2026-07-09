// Camera "vision sensor" for the ear-to-shoulder flexibility test.
//
// The old test read the *phone's* tilt (gravity sensor) and called that your
// neck's bend — which it isn't. This module instead watches YOU through the
// front camera with a MediaPipe Pose Landmarker and reports, every frame, the
// geometry the test actually needs:
//   • the roll of your eye/ear line  → the real angle your head has tilted
//   • both shoulder positions        → so a shoulder sneaking up toward the
//                                       ear can be caught and discounted
//
// The model + wasm are pulled from a CDN on first use (a few MB, cached by the
// browser). Everything runs on-device: camera frames never leave the phone.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// BlazePose 33-landmark indices we care about.
const IX = { nose: 0, eyeL: 2, eyeR: 5, earL: 7, earR: 8, shL: 11, shR: 12 };

let landmarker = null;
let loadPromise = null;

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
    typeof WebAssembly === 'object' &&
    // dynamic import of a remote module — required to fetch the vision bundle
    typeof window !== 'undefined';
}

// Load the pose model once (single-flight). Resolves to the landmarker or
// rejects if the CDN / wasm / model can't be fetched.
export function loadDetector() {
  if (landmarker) return Promise.resolve(landmarker);
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
    const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    // GPU is faster but unavailable on some devices/browsers — fall back to CPU.
    try {
      landmarker = await make('GPU');
    } catch {
      landmarker = await make('CPU');
    }
    return landmarker;
  })().catch((err) => {
    loadPromise = null; // allow a later retry
    throw err;
  });
  return loadPromise;
}

export async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.playsInline = true;
  video.muted = true;
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Read one frame. `tsMs` must strictly increase across calls.
// Returns { ok:false } until a confident, well-framed pose is present.
export function readPose(video, tsMs) {
  if (!landmarker || video.readyState < 2 || !video.videoWidth) return { ok: false };
  let res;
  try {
    res = landmarker.detectForVideo(video, tsMs);
  } catch {
    return { ok: false };
  }
  const lm = res?.landmarks?.[0];
  if (!lm) return { ok: false };

  const g = (i) => lm[i];
  const nose = g(IX.nose);
  const eyeL = g(IX.eyeL), eyeR = g(IX.eyeR);
  const earL = g(IX.earL), earR = g(IX.earR);
  const shL = g(IX.shL), shR = g(IX.shR);

  // Need eyes + both shoulders visible to trust a reading.
  const vis = Math.min(
    eyeL.visibility ?? 1, eyeR.visibility ?? 1,
    shL.visibility ?? 1, shR.visibility ?? 1,
  );

  // Roll of the eye line. Order the two eyes by image-x so the vector always
  // points rightward — that keeps the angle a small signed value around 0°
  // (level) instead of wrapping near ±180°.
  const [a, b] = eyeL.x <= eyeR.x ? [eyeL, eyeR] : [eyeR, eyeL];
  const rollDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

  const shoulderWidth = Math.hypot(shR.x - shL.x, shR.y - shL.y) || 1e-3;

  return {
    ok: vis > 0.5,
    vis,
    rollDeg,                       // head-tilt roll (signed); use vs a baseline
    shoulderTiltY: shR.y - shL.y,  // rest-relative → a one-sided shrug
    shoulderWidth,                 // scale reference (distance-invariant)
    shLY: shL.y,
    shRY: shR.y,
    noseY: nose.y,
    eyeMidY: (eyeL.y + eyeR.y) / 2,
    pts: {
      nose: xy(nose), eyeL: xy(eyeL), eyeR: xy(eyeR),
      earL: xy(earL), earR: xy(earR), shL: xy(shL), shR: xy(shR),
    },
  };
}

function xy(p) { return { x: p.x, y: p.y, v: p.visibility ?? 1 }; }
