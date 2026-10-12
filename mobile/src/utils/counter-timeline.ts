import type { FrameResult } from 'pose-tracker';
import { RepetitionCounter, type RepetitionCounterOptions } from './repetition-counter';
import { getJointSignals, type PostureAssessment, type SignalState } from './exercise-feedback';
import type { AngleQuality } from './pose-measurement';

export type CounterSnapshot = {
  reps: number; angle: number; progress: number; quality: AngleQuality;
  space: 'world' | 'image' | null; side: 'left' | 'right' | null;
  posture: PostureAssessment; pose: SignalState; flexed: SignalState; extended: SignalState;
  phase: ReturnType<RepetitionCounter['getState']>;
};

export function readCounterSnapshot(counter: RepetitionCounter, options: RepetitionCounterOptions): CounterSnapshot {
  const quality = counter.hasCurrentAngle() ? counter.getAngleQuality() : 'unavailable';
  const status = counter.getPoseAssessment().status;
  return {
    reps: counter.getRepCount(), angle: Math.round(counter.getCurrentAngle()),
    progress: counter.hasCurrentAngle() ? Math.round(counter.getCurrentRepProgress()) : 0,
    quality, space: counter.getMeasurementSpace(), side: counter.getActiveJointSide(),
    posture: counter.getPostureAssessment(),
    phase: counter.getState(),
    pose: status === 'accepted' ? 'yes' : status === 'acquiring' ? 'unknown' : 'no',
    ...getJointSignals(counter.getCurrentAngle(), options.minAngleThreshold, options.maxAngleThreshold, quality, options.endpointTolerancePercent),
  };
}

/** One forward pass, then O(1) lookup even when the user scrubs backwards. */
export function buildCounterTimeline(frames: FrameResult[], options: RepetitionCounterOptions) {
  const counter = new RepetitionCounter(options);
  const snapshots = new Map<number, CounterSnapshot>();
  const displayFrames = frames.map((frame) => {
    counter.processFrame(frame);
    snapshots.set(frame.timestampMs, readCounterSnapshot(counter, options));
    const poseAssessment = counter.getPoseAssessment();
    return { ...frame, poseAssessment, poses: poseAssessment.status === 'accepted' ? frame.poses : [] };
  });
  counter.finishPendingJointSelection();
  if (frames.length) snapshots.set(frames[frames.length - 1].timestampMs, readCounterSnapshot(counter, options));
  return { snapshots, displayFrames, repetitions: counter.getCompletedRepetitions() };
}
