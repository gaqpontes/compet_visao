import type { NormalizedLandmark } from './PoseTracker.types';

/** Visibility measures occlusion; presence measures whether the joint exists in the frame. */
export function getLandmarkConfidence(point: NormalizedLandmark): number | null {
  const visibility = point.visibility ?? 1;
  if (!Number.isFinite(visibility) || visibility < 0 || visibility > 1) return null;
  if (point.presence !== undefined && (!Number.isFinite(point.presence) || point.presence < 0.5 || point.presence > 1)) return null;
  // A hidden joint needs explicit model confidence; missing scores cannot authorize an estimate.
  if (visibility < 0.3 && (point.presence === undefined || point.presence < 0.8)) return null;
  return visibility * 0.7 + (point.presence ?? visibility) * 0.3;
}
