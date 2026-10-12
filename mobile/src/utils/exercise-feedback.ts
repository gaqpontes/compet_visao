import { getEndpointThresholds } from './endpoint-tolerance';
import type { FrameResult } from 'pose-tracker';
import type { AngleQuality } from './pose-measurement';

export type SignalState = 'yes' | 'no' | 'unknown';
export type BenchPosture = 'flat' | 'incline';
export type PostureAssessment = { state: SignalState; label: string; angleDeg?: number };

/** The shin is a local vertical reference when the feet support the bench press.
 * Using the angle BETWEEN body segments makes this invariant to camera roll.
 * This indicates compatibility with the posture, not a measured bench inclination.
 */
export function assessBenchPosture(frame: FrameResult, posture?: BenchPosture): PostureAssessment {
  if (!posture) return { state: 'unknown', label: 'Não avaliada neste exercício' };
  if (frame.poseAssessment && frame.poseAssessment.status !== 'accepted') {
    return { state: 'unknown', label: 'Pose instável' };
  }
  const image = frame.poses[0];
  if (!image) return { state: 'unknown', label: 'Sem pose' };

  const confidence = (indices: number[]) => Math.min(...indices.map((i) => {
    const point = image[i];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.presence ?? 1) >= 0.5
      ? point.visibility ?? 1 : 0;
  }));
  // A hidden far side must not invalidate the visible supporting side.
  const sides = [[11, 23, 25, 27], [12, 24, 26, 28]].sort((a, b) => confidence(b) - confidence(a));
  const indices = sides[0];
  if (confidence(indices) < 0.3) return { state: 'unknown', label: 'Pernas ou tronco ocultos' };
  const world = frame.worldPoses?.[0];
  const use3D = indices.every((i) => world?.[i] && ['x', 'y', 'z'].every((axis) =>
    Number.isFinite(world[i][axis as 'x' | 'y' | 'z'])));
  const points = use3D ? world! : image;
  const aspect = frame.imageSize ? frame.imageSize.height / frame.imageSize.width : 1;
  const xyz = (i: number) => [points[i].x, points[i].y * (use3D ? 1 : aspect), use3D ? points[i].z : 0];
  const [shoulder, hip, knee, ankle] = indices.map(xyz);
  const trunk = shoulder.map((v, i) => v - hip[i]);
  const shin = ankle.map((v, i) => v - knee[i]);
  const norm = Math.hypot(...trunk) * Math.hypot(...shin);
  if (!Number.isFinite(norm) || norm < 1e-4) return { state: 'unknown', label: 'Vista insuficiente' };
  const cosine = trunk.reduce((sum, v, i) => sum + v * shin[i], 0) / norm;
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  // Deliberate overlap: uncertain depth cannot reliably distinguish every bench angle.
  // An inclined athlete can have oblique shins: also inspect the hip and knee,
  // rather than interpreting the shin as a gravity sensor or measuring the bench.
  const segmentAngle = (a: number[], b: number[]) => {
    const length = Math.hypot(...a) * Math.hypot(...b);
    return length > 1e-4 ? Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, v, i) => sum + v * b[i], 0) / length))) * 180 / Math.PI : NaN;
  };
  const thigh = knee.map((v, i) => v - hip[i]);
  const hipAngle = segmentAngle(trunk, thigh);
  const kneeAngle = segmentAngle(thigh.map((v) => -v), shin);
  const reclinedSupport = hipAngle >= 140 && kneeAngle >= 50 && kneeAngle <= 150 && angleDeg >= 45 && angleDeg <= 155;
  const compatible = posture === 'flat' ? angleDeg >= 45 && angleDeg <= 135
    : (angleDeg >= 110 && angleDeg <= 155) || reclinedSupport;
  return {
    state: compatible ? 'yes' : 'no',
    label: compatible ? (posture === 'flat' ? 'Deitado · compatível' : 'Inclinado · compatível') : 'Fora da posição esperada',
    angleDeg,
  };
}

export function getJointSignals(angle: number, min: number, max: number, quality: AngleQuality, tolerancePercent?: number) {
  if (!Number.isFinite(angle) || quality !== 'observed') {
    return { flexed: 'unknown' as SignalState, extended: 'unknown' as SignalState };
  }
  const endpoints = getEndpointThresholds(min, max, tolerancePercent);
  return {
    flexed: (angle <= endpoints.flexion ? 'yes' : 'no') as SignalState,
    extended: (angle >= endpoints.extension ? 'yes' : 'no') as SignalState,
  };
}
