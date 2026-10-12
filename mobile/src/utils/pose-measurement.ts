import type { FrameResult, NormalizedLandmark } from 'pose-tracker';
import { calculateDistance } from './biomechanics';
import { getLandmarkConfidence } from '../../modules/pose-tracker/src/landmark-confidence';

export type AngleQuality = 'observed' | 'estimated' | 'unavailable';
export type JointMeasurement = {
  points: [NormalizedLandmark, NormalizedLandmark, NormalizedLandmark];
  use3D: boolean;
  space: 'world' | 'image';
  quality: Exclude<AngleQuality, 'unavailable'>;
  confidence: number;
};

/** Use metric 3D points when available; image points remain in a common scale for 2D fallback. */
export function measureJoint(
  frame: FrameResult,
  indices: [number, number, number],
  prefer3D: boolean
): JointMeasurement | null {
  const imagePoints = indices.map((index) => frame.poses?.[0]?.[index]);
  if (imagePoints.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const confidences = imagePoints.map(getLandmarkConfidence);
  if (confidences.some((confidence) => confidence === null)) return null;

  const worldPoints = indices.map((index) => frame.worldPoses?.[0]?.[index]);
  const use3D = prefer3D && worldPoints.every((point) => point &&
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  const size = frame.imageSize;
  const yScale = size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    ? size.height / size.width
    : 1;
  const sourcePoints = (use3D ? worldPoints : imagePoints) as NormalizedLandmark[];
  const points = sourcePoints.map((point, index) => ({
    ...point,
    y: use3D ? point.y : point.y * yScale,
    visibility: imagePoints[index].visibility,
    presence: imagePoints[index].presence,
  })) as JointMeasurement['points'];
  if (calculateDistance(points[0], points[1], use3D) < 1e-6 ||
      calculateDistance(points[2], points[1], use3D) < 1e-6) return null;

  return {
    points,
    use3D,
    space: use3D ? 'world' : 'image',
    quality: imagePoints.some((point) => (point.visibility ?? 1) < 0.3) ? 'estimated' : 'observed',
    confidence: Math.min(...confidences as number[]),
  };
}

/** Penalize implausible metric limb proportions and occluded predictions during side selection. */
export function getJointCandidateScore(measurement: JointMeasurement | null): number {
  if (!measurement) return -1;
  const [a, b, c] = measurement.points;
  const first = calculateDistance(a, b, measurement.use3D);
  const second = calculateDistance(c, b, measurement.use3D);
  // Projected lengths can differ due to foreshortening; apply anatomy only in metric 3D.
  const ratio = measurement.use3D ? Math.min(first, second) / Math.max(first, second) : 1;
  const anatomy = Math.min(1, ratio / 0.5);
  return measurement.confidence * anatomy * (measurement.quality === 'observed' ? 1 : 0.25);
}
