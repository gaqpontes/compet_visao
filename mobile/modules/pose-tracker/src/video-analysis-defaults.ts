import type { VideoAnalysisOptions } from './PoseTracker.types';

/** Recommended file-analysis settings shared by Web, Android and iOS. */
export const DEFAULT_VIDEO_ANALYSIS_OPTIONS: Readonly<Required<Pick<
  VideoAnalysisOptions, 'poseModel' | 'fps' | 'scale' | 'detectHands'
>>> = Object.freeze({
  poseModel: 'full',
  fps: 8,
  scale: 'one-third',
  detectHands: false,
});
