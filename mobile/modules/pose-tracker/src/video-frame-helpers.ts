export type ProcessingScale = 'one-third' | 'two-thirds' | 'original';

export type FrameDimensions = {
  width: number;
  height: number;
};

export const PLAYBACK_TIME_EPSILON_SECONDS = 0.001;
const PLAYBACK_TARGET_TOLERANCE_SECONDS = 0.005;

/** Density of actual media samples, distinct from inference throughput per wall-clock second. */
export function getEffectiveSampleRate(frames: { timestampMs: number }[]): number | null {
  if (frames.length < 2) return null;
  const duration = frames[frames.length - 1].timestampMs - frames[0].timestampMs;
  return duration > 0 ? (frames.length - 1) * 1000 / duration : null;
}

/** True only after playback reaches the target and advances beyond the last captured media time. */
export function hasFreshPlaybackFrame(
  currentTimeSeconds: number,
  targetTimeSeconds: number,
  previousMediaTimeSeconds: number
): boolean {
  return (
    currentTimeSeconds >= targetTimeSeconds - PLAYBACK_TARGET_TOLERANCE_SECONDS &&
    currentTimeSeconds > previousMediaTimeSeconds + PLAYBACK_TIME_EPSILON_SECONDS
  );
}

export function getInclusiveSampleCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('A duração não pode ser negativa e o FPS deve ser maior que zero.');
  }
  return Math.floor(durationSeconds * fps + 1e-9) + 1;
}

export function getSampleTime(startTimeSeconds: number, frameIndex: number, fps: number): number {
  if (
    !Number.isFinite(startTimeSeconds) ||
    startTimeSeconds < 0 ||
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    throw new Error('Os parâmetros de amostragem são inválidos.');
  }
  return startTimeSeconds + frameIndex / fps;
}

/** Scales both dimensions together so video frames keep their source aspect ratio. */
export function getScaledFrameDimensions(
  sourceWidth: number,
  sourceHeight: number,
  scale: ProcessingScale
): FrameDimensions {
  if (!['one-third', 'two-thirds', 'original'].includes(scale)) {
    throw new Error('A escala de processamento é inválida.');
  }
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    throw new Error('As dimensões de origem devem ser positivas.');
  }

  const scaleFactor = scale === 'one-third' ? 1 / 3 : scale === 'two-thirds' ? 2 / 3 : 1;
  return {
    width: Math.max(1, Math.round(sourceWidth * scaleFactor)),
    height: Math.max(1, Math.round(sourceHeight * scaleFactor)),
  };
}
