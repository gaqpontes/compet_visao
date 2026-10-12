import type { FrameResult } from 'pose-tracker';
import type { CounterSnapshot } from './counter-timeline';

export function findTimelineIndex(frames: Pick<FrameResult, 'timestampMs'>[], timeMs: number): number {
  if (!frames.length) return -1;
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].timestampMs < timeMs) low = mid + 1;
    else high = mid;
  }
  return low > 0 && Math.abs(frames[low - 1].timestampMs - timeMs) <= Math.abs(frames[low].timestampMs - timeMs) ? low - 1 : low;
}

/** Split the curve at unavailable readings and outages: never draw invented motion across a gap. */
export function getAngleSegments(frames: FrameResult[], snapshots: Map<number, CounterSnapshot>) {
  const segments: { timestampMs: number; angle: number }[][] = [];
  let segment: { timestampMs: number; angle: number }[] = [];
  for (const frame of frames) {
    const snapshot = snapshots.get(frame.timestampMs);
    if (!snapshot || snapshot.quality === 'unavailable') {
      if (segment.length) segments.push(segment);
      segment = [];
      continue;
    }
    if (segment.length && frame.timestampMs - segment[segment.length - 1].timestampMs > 250) {
      segments.push(segment);
      segment = [];
    }
    segment.push({ timestampMs: frame.timestampMs, angle: snapshot.angle });
  }
  if (segment.length) segments.push(segment);
  return segments;
}
