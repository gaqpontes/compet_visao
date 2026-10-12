import type { FrameResult, PoseAssessment } from './PoseTracker.types';

type BodyGeometry = { x: number; y: number; dx: number; dy: number; scale: number };

function geometry(frame: FrameResult): BodyGeometry | null {
  const pose = frame.poses[0];
  const points = [11, 12, 23, 24].map((i) => pose?.[i]);
  if (points.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const aspect = frame.imageSize ? frame.imageSize.height / frame.imageSize.width : 1;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const [ls, rs, lh, rh] = points;
  const sx = (ls.x + rs.x) / 2, sy = (ls.y + rs.y) * aspect / 2;
  const hx = (lh.x + rh.x) / 2, hy = (lh.y + rh.y) * aspect / 2;
  const dx = hx - sx, dy = hy - sy;
  const scale = Math.hypot(dx, dy);
  // Joint-only callers may not supply a torso. Joint validity is checked separately.
  if (scale < 1e-4) return null;
  return { x: (sx + hx) / 2, y: (sy + hy) / 2, dx, dy, scale };
}

function discontinuity(previous: BodyGeometry, current: BodyGeometry): PoseAssessment['reason'] | undefined {
  const cosine = (previous.dx * current.dx + previous.dy * current.dy) / (previous.scale * current.scale);
  if (cosine < -0.2) return 'body-flip';
  const ratio = current.scale / previous.scale;
  if (ratio < 0.45 || ratio > 2.2) return 'body-scale';
  if (Math.hypot(current.x - previous.x, current.y - previous.y) > previous.scale * 1.5) return 'body-jump';
  return undefined;
}

/** Tracks body geometry in the image plane; any initial camera orientation is allowed.
 * Rejected detections never replace the anchor. After a long outage, reacquisition
 * requires 300 ms of a stable new view rather than trusting the first prediction.
 */
export class PoseContinuityFilter {
  private anchor: BodyGeometry | null = null;
  private acceptedAt = -1;
  private lastTimestamp = -1;
  private candidate: BodyGeometry | null = null;
  private candidateSince = -1;

  assess(frame: FrameResult): PoseAssessment {
    const time = frame.timestampMs;
    if (!Number.isFinite(time) || time <= this.lastTimestamp) {
      return { status: 'rejected', reason: 'invalid-timestamp' };
    }
    this.lastTimestamp = time;
    if (!frame.poses?.[0]?.length) return { status: 'rejected', reason: 'missing-pose' };
    const current = geometry(frame);
    if (!current) {
      return this.anchor
        ? { status: 'rejected', reason: 'body-scale' }
        : { status: 'accepted' };
    }
    if (this.anchor && time - this.acceptedAt > 3000) {
      if (!this.candidate || discontinuity(this.candidate, current)) {
        this.candidate = current;
        this.candidateSince = time;
      }
      if (time - this.candidateSince < 300) return { status: 'acquiring', reason: 'reacquiring' };
    } else if (this.anchor) {
      const reason = discontinuity(this.anchor, current);
      if (reason) return { status: 'rejected', reason };
    }
    this.anchor = current;
    this.acceptedAt = time;
    this.candidate = null;
    return { status: 'accepted' };
  }
}
