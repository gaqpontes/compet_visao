import type { FrameResult } from 'pose-tracker';
import { getLandmarkConfidence } from '../../modules/pose-tracker/src/landmark-confidence';

/** Wrist elevation relative to the trunk, in trunk lengths. Invariant to camera roll/scale. */
export function getBenchWristElevation(frame: FrameResult, side: 'left' | 'right'): number | null {
  const pose = frame.poses[0];
  const indices = side === 'left' ? [11, 23, 15] : [12, 24, 16];
  if (!pose || indices.some((i) => !pose[i] || (pose[i].visibility ?? 1) < 0.3 || (getLandmarkConfidence(pose[i]) ?? 0) < 0.3)) return null;
  const aspect = frame.imageSize ? frame.imageSize.height / frame.imageSize.width : 1;
  const xy = (i: number) => [pose[i].x, pose[i].y * aspect];
  const shoulder = xy(indices[0]), hip = xy(indices[1]), wrist = xy(indices[2]);
  const tx = shoulder[0] - hip[0];
  const ty = shoulder[1] - hip[1];
  const lengthSquared = tx * tx + ty * ty;
  if (lengthSquared < 1e-6 || !Number.isFinite(lengthSquared)) return null;
  const value = Math.abs(((wrist[0] - shoulder[0]) * ty - (wrist[1] - shoulder[1]) * tx) / lengthSquared);
  return Number.isFinite(value) && value <= 2 ? value : null;
}

/** A complete descent and return to the starting elevation; never count an initial ascent. */
export class BenchTravelCounter {
  private previousTimestamp = -1;
  private value: number | null = null;
  private top = 0;
  private bottom = 0;
  private start = 0;
  private descending = false;

  getState(): 'EXTENDED' | 'FLEXING' | 'FLEXED' | 'EXTENDING' {
    if (!this.descending) return 'EXTENDED';
    return (this.value ?? this.bottom) > this.bottom + 0.06 ? 'EXTENDING' : 'FLEXED';
  }
  getProgress() { return this.descending ? Math.max(0, Math.min(100, 100 * (this.top - (this.value ?? this.top)) / Math.max(0.25, this.top - this.bottom))) : 0; }

  reset() { this.previousTimestamp = -1; this.value = null; this.descending = false; }

  process(timestampMs: number, elevation: number | null): { startTimestampMs: number; endTimestampMs: number } | null {
    if (!Number.isFinite(timestampMs) || timestampMs <= this.previousTimestamp) return null;
    if (elevation === null || !Number.isFinite(elevation)) {
      if (timestampMs - this.previousTimestamp > 250) this.reset();
      return null;
    }
    const gap = timestampMs - this.previousTimestamp;
    if (gap > 500 || this.value === null) {
      this.value = this.top = this.bottom = elevation;
      this.descending = false;
      this.start = timestampMs;
    } else this.value += (1 - Math.pow(0.35, gap / 125)) * (elevation - this.value);
    this.previousTimestamp = timestampMs;
    const value = this.value;
    if (!this.descending) {
      if (value >= this.top) { this.top = value; this.start = timestampMs; }
      if (this.top - value >= 0.25) { this.bottom = value; this.descending = true; }
    } else {
      this.bottom = Math.min(this.bottom, value);
      const excursion = this.top - this.bottom;
      if (timestampMs - this.start > 10000) { this.reset(); return null; }
      if (value >= this.bottom + Math.max(0.25, excursion * 0.75) && timestampMs - this.start >= 500) {
        const result = { startTimestampMs: this.start, endTimestampMs: timestampMs };
        this.top = value; this.start = timestampMs; this.descending = false;
        return result;
      }
    }
    return null;
  }
}
