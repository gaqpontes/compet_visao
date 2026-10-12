import { getEndpointThresholds } from './endpoint-tolerance';
import { BenchTravelCounter, getBenchWristElevation } from './bench-travel';
import type { FrameResult, NormalizedLandmark, PoseAssessment } from 'pose-tracker';
import { PoseContinuityFilter } from '../../modules/pose-tracker/src/pose-continuity';
import { assessBenchPosture, type BenchPosture, type PostureAssessment } from './exercise-feedback';
import { calculateAngle, getTemporalSmoothingAlpha, smoothLandmarks } from './biomechanics';
import { measureJoint, getJointCandidateScore, type AngleQuality } from './pose-measurement';

export type RepetitionCounterOptions = {
  benchWristTravel?: boolean;
  endpointTolerancePercent?: number; // 0–40% da faixa configurada; padrão do app: 20%
  jointIndices: [number, number, number]; // [A, B, C], onde B é o vértice da articulação
  jointIndexCandidates?: Array<{
    side: 'left' | 'right';
    jointIndices: [number, number, number];
  }>;
  jointCandidateSelectionDurationMs?: number;
  minAngleThreshold: number;              // Ângulo de contração máxima (ex: 50° - 60°)
  maxAngleThreshold: number;              // Ângulo de extensão completa (ex: 145° - 160°)
  minDurationMs?: number;                 // Duração mínima por repetição para rejeitar spikes (default: 200ms)
  smoothingAlpha?: number;                // Fator EMA de referência a 15 FPS (default: 0.45)
  endpointDwellMs?: number;               // Tempo mínimo para confirmar os extremos (default: 100ms)
  use3D?: boolean;                        // Prefere coordenadas métricas 3D; fallback para imagem 2D corrigida
  requiredPosture?: BenchPosture;
  maxAngularVelocityDegPerSecond?: number;
};

export type RepState = 'EXTENDED' | 'FLEXING' | 'FLEXED' | 'EXTENDING';
export type CompletedRepetition = { index: number; startTimestampMs: number; endTimestampMs: number };

export const DEFAULT_JOINT_CANDIDATE_SELECTION_DURATION_MS = 1000;

export class RepetitionCounter {
  private options: RepetitionCounterOptions;
  private benchTravel = new BenchTravelCounter();
  private repCount: number = 0;
  private currentState: RepState = 'EXTENDED';
  private currentAngle: number = 180;
  private currentAngleValid: boolean = false;
  private angleQuality: AngleQuality = 'unavailable';
  private measurementSpace: 'world' | 'image' | null = null;
  private alternateCandidateIndex: number | null = null;
  private alternateCandidateSinceMs: number | null = null;
  private currentProgress: number = 0; // 0 a 100%

  private repStartTimeMs: number = 0;
  private peakFlexionReached: boolean = false;
  private extensionObserved: boolean = false;
  private flexionCandidateStartMs: number | null = null;
  private extensionCandidateStartMs: number | null = null;
  private previousPoseLandmarks: NormalizedLandmark[] = [];
  private lastProcessedTimestamp: number = -1;
  private activeJointCandidate: NonNullable<RepetitionCounterOptions['jointIndexCandidates']>[number] | null = null;
  private pendingJointFrames: FrameResult[] = [];
  private jointCandidateConfidenceSums: number[] = [];
  private jointCandidateConfidenceCounts: number[] = [];
  private jointCandidateSelectionStartMs: number | null = null;
  private poseFilter = new PoseContinuityFilter();
  private poseAssessment: PoseAssessment = { status: 'rejected', reason: 'missing-pose' };
  private posture: PostureAssessment = { state: 'unknown', label: 'Sem leitura' };
  private postureConfirmed = false;
  private postureSince: number | null = null;
  private lastCorrectPostureAt = -1;
  private incorrectPostureSince: number | null = null;
  private completedRepetitions: CompletedRepetition[] = [];
  private lastRawMeasurement: { angle: number; timestampMs: number; space: string } | null = null;
  private estimatedSince: number | null = null;
  private lastInputTimestamp = -1;

  constructor(options: RepetitionCounterOptions) {
    this.options = {
      minDurationMs: 200,
      smoothingAlpha: 0.45,
      endpointDwellMs: 100,
      jointCandidateSelectionDurationMs: DEFAULT_JOINT_CANDIDATE_SELECTION_DURATION_MS,
      ...options,
    };
    if (
      !Number.isFinite(this.options.minAngleThreshold) ||
      !Number.isFinite(this.options.maxAngleThreshold) ||
      this.options.minAngleThreshold < 0 ||
      this.options.maxAngleThreshold > 180 ||
      this.options.minAngleThreshold >= this.options.maxAngleThreshold
    ) {
      throw new Error('Os limiares angulares devem estar entre 0° e 180°, em ordem crescente.');
    }
    if (
      !this.options.jointIndices.every((index) => Number.isInteger(index) && index >= 0 && index < 33) ||
      (this.options.jointIndexCandidates ?? []).some((candidate) =>
        !candidate.jointIndices.every((index) => Number.isInteger(index) && index >= 0 && index < 33)
      ) ||
      !Number.isFinite(this.options.minDurationMs) ||
      this.options.minDurationMs! < 0 ||
      (this.options.maxAngularVelocityDegPerSecond !== undefined &&
        (!Number.isFinite(this.options.maxAngularVelocityDegPerSecond) || this.options.maxAngularVelocityDegPerSecond <= 0)) ||
      !Number.isFinite(this.options.endpointDwellMs) ||
      this.options.endpointDwellMs! < 0 ||
      !Number.isFinite(this.options.jointCandidateSelectionDurationMs) ||
      this.options.jointCandidateSelectionDurationMs! < 0
    ) {
      throw new Error('Os índices das articulações e as durações do contador são inválidos.');
    }
    getEndpointThresholds(this.options.minAngleThreshold, this.options.maxAngleThreshold, this.options.endpointTolerancePercent);
    this.currentAngle = this.options.maxAngleThreshold;
  }

  public processFrame(frame: FrameResult): void {
    if (Number.isFinite(frame.timestampMs)) this.lastInputTimestamp = frame.timestampMs;
    this.currentAngleValid = false;
    this.angleQuality = 'unavailable';
    this.poseAssessment = frame.poseAssessment ?? this.poseFilter.assess(frame);
    this.posture = assessBenchPosture({ ...frame, poseAssessment: this.poseAssessment }, this.options.requiredPosture);
    if (this.poseAssessment.status !== 'accepted') {
      if (this.poseAssessment.reason !== 'missing-pose' && this.poseAssessment.reason !== 'invalid-timestamp') {
        this.clearMotionHistory();
        this.clearPendingSelection();
      }
      return;
    }
    let canCount = true;
    if (this.options.requiredPosture) {
      if (this.posture.state === 'yes') {
        this.incorrectPostureSince = null;
        this.postureSince ??= frame.timestampMs;
        this.lastCorrectPostureAt = frame.timestampMs;
        canCount = this.postureConfirmed || frame.timestampMs - this.postureSince >= 300;
        this.postureConfirmed = canCount;
      } else {
        this.postureSince = null;
        canCount = false;
        if (this.posture.state === 'no') this.incorrectPostureSince ??= frame.timestampMs;
        else this.incorrectPostureSince = null;
        const sustainedWrongPosture = this.incorrectPostureSince !== null && frame.timestampMs - this.incorrectPostureSince >= 300;
        if (sustainedWrongPosture || (this.posture.state === 'unknown' && frame.timestampMs - this.lastCorrectPostureAt > 500)) {
          this.postureConfirmed = false;
          this.clearRepetitionPhase();
          this.clearPendingSelection();
        }
      }
    }
    if (this.options.jointIndexCandidates?.length && !this.activeJointCandidate) {
      if (!canCount) {
        this.processMeasurement(frame, false);
        return;
      }
      this.collectJointCandidateFrame(frame);
      return;
    }
    this.processMeasurement(frame, canCount);
  }

  private processMeasurement(frame: FrameResult, canCount = true): void {
    this.currentAngleValid = false;
    this.angleQuality = 'unavailable';
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= this.lastProcessedTimestamp) return;
    this.updateJointCandidate(frame);
    const indices = this.activeJointCandidate?.jointIndices ?? this.options.jointIndices;
    // Wrist cycles do not require a visible elbow; keep its angle as an independent display.
    if (this.options.benchWristTravel && canCount) {
      const side = this.activeJointCandidate?.side ?? (indices[0] === 11 ? 'left' : 'right');
      const completed = this.benchTravel.process(frame.timestampMs, getBenchWristElevation(frame, side));
      this.currentState = this.benchTravel.getState();
      this.currentProgress = this.benchTravel.getProgress();
      if (completed) { this.repStartTimeMs = completed.startTimestampMs; this.completeRepetition(completed.endTimestampMs); }
    }
    const measurement = measureJoint(frame, indices, this.options.use3D ?? false);
    if (!measurement) return;
    const measuredAngle = calculateAngle(...measurement.points, measurement.use3D);
    const previousRaw = this.lastRawMeasurement;
    const rawGap = previousRaw ? frame.timestampMs - previousRaw.timestampMs : Infinity;
    const maxVelocity = this.options.maxAngularVelocityDegPerSecond;
    if (!this.options.benchWristTravel && maxVelocity && previousRaw && previousRaw.space === measurement.space && rawGap > 0 && rawGap < 750 &&
        Math.abs(measuredAngle - previousRaw.angle) > 15 + maxVelocity * rawGap / 1000) {
      this.poseAssessment = { status: 'rejected', reason: 'joint-jump' };
      this.posture = { state: 'unknown', label: 'Pose instável' };
      this.clearRepetitionPhase();
      return;
    }
    this.lastRawMeasurement = { angle: measuredAngle, timestampMs: frame.timestampMs, space: measurement.space };
    if (measurement.quality === 'estimated') {
      this.estimatedSince ??= frame.timestampMs;
      if (frame.timestampMs - this.estimatedSince > 250) {
        this.clearRepetitionPhase();
        return;
      }
    } else this.estimatedSince = null;

    const elapsedMs = this.lastProcessedTimestamp < 0
      ? Number.POSITIVE_INFINITY
      : frame.timestampMs - this.lastProcessedTimestamp;
    if (elapsedMs > (this.options.benchWristTravel ? 500 : 250) || this.measurementSpace !== measurement.space) {
      if (this.options.benchWristTravel) this.previousPoseLandmarks = [];
      else this.clearMotionHistory();
    }
    let pose: NormalizedLandmark[] = measurement.points;
    if (this.previousPoseLandmarks.length > 0) {
      pose = smoothLandmarks(this.previousPoseLandmarks, pose,
        getTemporalSmoothingAlpha(this.options.smoothingAlpha ?? 0.45, elapsedMs));
    }
    const rawAngle = calculateAngle(pose[0], pose[1], pose[2], measurement.use3D);
    if (!Number.isFinite(rawAngle)) return;
    this.measurementSpace = measurement.space;
    this.angleQuality = measurement.quality;
    this.previousPoseLandmarks = pose;
    this.lastProcessedTimestamp = frame.timestampMs;
    this.currentAngle = rawAngle;
    this.currentAngleValid = true;

    const {
      minAngleThreshold,
      maxAngleThreshold,
      minDurationMs = 200,
      endpointDwellMs = 100,
    } = this.options;

    const endpoints = getEndpointThresholds(minAngleThreshold, maxAngleThreshold, this.options.endpointTolerancePercent);

    // Calcula progresso da repetição atual de 0% (totalmente estendido) a 100% (flexão máxima)
    const progressMin = this.options.endpointTolerancePercent === undefined ? minAngleThreshold : endpoints.flexion;
    const progressMax = this.options.endpointTolerancePercent === undefined ? maxAngleThreshold : endpoints.extension;
    const range = progressMax - progressMin;
    if (range > 0 && !this.options.benchWristTravel) {
      const progress = ((progressMax - rawAngle) / range) * 100;
      this.currentProgress = Math.max(0, Math.min(100, progress));
    }
    if (this.options.benchWristTravel) return;
    // An occluded prediction may be displayed briefly but cannot establish an endpoint.
    if (!canCount || measurement.quality === 'estimated') {
      this.flexionCandidateStartMs = null;
      this.extensionCandidateStartMs = null;
      return;
    }

    // Starting in the lower half of a cycle cannot establish its missing descent.
    // One observed extension sample arms the next cycle; its endpoints still need dwell.
    // Check raw geometry too, so an old smoothed estimate cannot authorize the start.
    if (!this.extensionObserved) {
      if (measuredAngle >= endpoints.extension && rawAngle >= endpoints.extension) {
        this.extensionObserved = true;
      }
      return;
    }

    switch (this.currentState) {
      case 'EXTENDED':
        if (rawAngle < endpoints.extension) {
          this.currentState = 'FLEXING';
          this.repStartTimeMs = frame.timestampMs;
          this.peakFlexionReached = false;
          this.flexionCandidateStartMs = rawAngle <= endpoints.flexion ? frame.timestampMs : null;
          if (this.flexionCandidateStartMs !== null && endpointDwellMs === 0) {
            this.currentState = 'FLEXED';
            this.peakFlexionReached = true;
          }
          this.extensionCandidateStartMs = null;
        }
        break;

      case 'FLEXING':
        // Confirma a flexão somente quando o ângulo permanece no extremo por tempo suficiente.
        if (rawAngle <= endpoints.flexion) {
          this.flexionCandidateStartMs ??= frame.timestampMs;
          if (frame.timestampMs - this.flexionCandidateStartMs >= endpointDwellMs) {
            this.currentState = 'FLEXED';
            this.peakFlexionReached = true;
            this.flexionCandidateStartMs = null;
          }
        } else if (rawAngle >= endpoints.extensionCancel) {
          // Desistiu e voltou sem completar flexão
          this.currentState = 'EXTENDED';
          this.flexionCandidateStartMs = null;
        } else {
          this.flexionCandidateStartMs = null;
        }
        break;

      case 'FLEXED':
        // Começa a estender de volta
        if (rawAngle > endpoints.flexionRelease) {
          this.currentState = 'EXTENDING';
          this.extensionCandidateStartMs = rawAngle >= endpoints.extension ? frame.timestampMs : null;
          if (this.extensionCandidateStartMs !== null && endpointDwellMs === 0) {
            if (this.peakFlexionReached && frame.timestampMs - this.repStartTimeMs >= minDurationMs) this.completeRepetition(frame.timestampMs);
            this.currentState = 'EXTENDED';
            this.peakFlexionReached = false;
            this.extensionCandidateStartMs = null;
          }
        }
        break;

      case 'EXTENDING':
        // Confirma a extensão sustentada antes de contar, filtrando picos de ruído.
        if (rawAngle >= endpoints.extension) {
          this.extensionCandidateStartMs ??= frame.timestampMs;
          if (frame.timestampMs - this.extensionCandidateStartMs >= endpointDwellMs) {
            const duration = frame.timestampMs - this.repStartTimeMs;
            if (this.peakFlexionReached && duration >= minDurationMs) {
              this.completeRepetition(frame.timestampMs);
            }
            this.currentState = 'EXTENDED';
            this.peakFlexionReached = false;
            this.extensionCandidateStartMs = null;
          }
        } else if (rawAngle <= endpoints.flexionReturn) {
          this.currentState = 'FLEXED';
          this.extensionCandidateStartMs = null;
        } else {
          this.extensionCandidateStartMs = null;
        }
        break;
    }
  }

  public getRepCount(): number {
    return this.repCount;
  }

  private completeRepetition(endTimestampMs: number): void {
    this.repCount++;
    this.completedRepetitions.push({ index: this.repCount, startTimestampMs: this.repStartTimeMs, endTimestampMs });
  }

  public getCompletedRepetitions(): CompletedRepetition[] {
    return this.completedRepetitions.map((repetition) => ({ ...repetition }));
  }

  public getPoseAssessment(): PoseAssessment { return this.poseAssessment; }
  public getPostureAssessment(): PostureAssessment { return this.posture; }

  public getCurrentAngle(): number {
    return this.currentAngle;
  }

  public hasCurrentAngle(): boolean {
    return this.currentAngleValid;
  }

  public getAngleQuality(): AngleQuality {
    return this.angleQuality;
  }

  public getMeasurementSpace(): 'world' | 'image' | null {
    return this.currentAngleValid ? this.measurementSpace : null;
  }

  public getCurrentRepProgress(): number {
    return this.currentProgress;
  }

  public getState(): RepState {
    return this.currentState;
  }

  public getActiveJointSide(): 'left' | 'right' | null {
    return this.activeJointCandidate?.side ?? null;
  }

  public finishPendingJointSelection(): void {
    if (this.options.jointIndexCandidates?.length && !this.activeJointCandidate && this.pendingJointFrames.length > 0) {
      this.selectJointCandidateAndReplayPendingFrames();
    }
    if (this.lastProcessedTimestamp !== this.lastInputTimestamp) {
      this.currentAngleValid = false;
      this.angleQuality = 'unavailable';
    }
  }

  private clearPendingSelection(): void {
    this.pendingJointFrames = [];
    this.jointCandidateConfidenceSums = [];
    this.jointCandidateConfidenceCounts = [];
    this.jointCandidateSelectionStartMs = null;
  }

  private collectJointCandidateFrame(frame: FrameResult): void {
    if (!Number.isFinite(frame.timestampMs)) return;
    const lastPendingFrame = this.pendingJointFrames[this.pendingJointFrames.length - 1];
    if (lastPendingFrame && frame.timestampMs <= lastPendingFrame.timestampMs) return;

    this.currentAngleValid = false;
    this.angleQuality = 'unavailable';
    const measurements = this.options.jointIndexCandidates!.map((candidate) =>
      measureJoint(frame, candidate.jointIndices, this.options.use3D ?? false)
    );
    // Do not lock onto a side before the athlete or a usable joint appears.
    if (!measurements.some(Boolean) && this.jointCandidateSelectionStartMs === null) return;
    this.pendingJointFrames.push(frame);
    this.jointCandidateSelectionStartMs ??= frame.timestampMs;
    measurements.forEach((measurement, index) => {
      this.jointCandidateConfidenceSums[index] = (this.jointCandidateConfidenceSums[index] ?? 0) + Math.max(0, getJointCandidateScore(measurement));
      this.jointCandidateConfidenceCounts[index] = (this.jointCandidateConfidenceCounts[index] ?? 0) + 1;
    });

    const elapsedMs = frame.timestampMs - this.jointCandidateSelectionStartMs;
    if (elapsedMs >= this.options.jointCandidateSelectionDurationMs! || this.pendingJointFrames.length >= 240) {
      this.selectJointCandidateAndReplayPendingFrames();
    }
  }

  private selectJointCandidateAndReplayPendingFrames(): void {
    const candidates = this.options.jointIndexCandidates ?? [];
    if (candidates.length === 0 || this.activeJointCandidate) return;

    let selectedIndex = 0;
    let selectedScore = Number.NEGATIVE_INFINITY;
    candidates.forEach((candidate, index) => {
      const count = this.jointCandidateConfidenceCounts[index] ?? 0;
      const score = count > 0
        ? (this.jointCandidateConfidenceSums[index] ?? 0) / count
        : Number.NEGATIVE_INFINITY;
      // Candidate order breaks ties (right is first for the bench-press presets).
      if (score > selectedScore) {
        selectedIndex = index;
        selectedScore = score;
      }
    });
    this.activeJointCandidate = candidates[selectedIndex];

    const pendingFrames = this.pendingJointFrames;
    this.pendingJointFrames = [];
    this.jointCandidateConfidenceSums = [];
    this.jointCandidateConfidenceCounts = [];
    this.jointCandidateSelectionStartMs = null;
    for (const frame of pendingFrames) this.processMeasurement(frame);
  }

  private clearRepetitionPhase(): void {
    this.extensionObserved = false;
    this.benchTravel.reset();
    this.currentState = 'EXTENDED';
    this.peakFlexionReached = false;
    this.flexionCandidateStartMs = null;
    this.extensionCandidateStartMs = null;
  }

  private clearMotionHistory(): void {
    this.clearRepetitionPhase();
    this.previousPoseLandmarks = [];
    this.measurementSpace = null;
    this.lastRawMeasurement = null;
  }

  private updateJointCandidate(frame: FrameResult): void {
    const candidates = this.options.jointIndexCandidates;
    if (!candidates?.length || !this.activeJointCandidate) return;
    const scores = candidates.map((candidate) =>
      getJointCandidateScore(measureJoint(frame, candidate.jointIndices, this.options.use3D ?? false))
    );
    const activeIndex = candidates.indexOf(this.activeJointCandidate);
    const bestIndex = scores.reduce((best, score, index) => score > scores[best] ? index : best, 0);
    if (scores[bestIndex] < 0 || bestIndex === activeIndex || scores[bestIndex] < scores[activeIndex] + 0.2) {
      this.alternateCandidateIndex = null;
      this.alternateCandidateSinceMs = null;
      return;
    }
    if (this.alternateCandidateIndex !== bestIndex) {
      this.alternateCandidateIndex = bestIndex;
      this.alternateCandidateSinceMs = frame.timestampMs;
    }
    if (frame.timestampMs - this.alternateCandidateSinceMs! >= 300) {
      this.activeJointCandidate = candidates[bestIndex];
      // A repetition cannot combine the flexion of one limb and extension of the other.
      this.clearMotionHistory();
      this.alternateCandidateIndex = null;
      this.alternateCandidateSinceMs = null;
    }
  }

  public reset(): void {
    this.extensionObserved = false;
    this.benchTravel.reset();
    this.poseFilter = new PoseContinuityFilter();
    this.poseAssessment = { status: 'rejected', reason: 'missing-pose' };
    this.posture = { state: 'unknown', label: 'Sem leitura' };
    this.postureSince = null;
    this.postureConfirmed = false;
    this.lastCorrectPostureAt = -1;
    this.incorrectPostureSince = null;
    this.completedRepetitions = [];
    this.lastRawMeasurement = null;
    this.estimatedSince = null;
    this.lastInputTimestamp = -1;
    this.repCount = 0;
    this.currentState = 'EXTENDED';
    this.currentAngle = this.options.maxAngleThreshold;
    this.currentAngleValid = false;
    this.angleQuality = 'unavailable';
    this.measurementSpace = null;
    this.alternateCandidateIndex = null;
    this.alternateCandidateSinceMs = null;
    this.currentProgress = 0;
    this.repStartTimeMs = 0;
    this.peakFlexionReached = false;
    this.flexionCandidateStartMs = null;
    this.extensionCandidateStartMs = null;
    this.previousPoseLandmarks = [];
    this.lastProcessedTimestamp = -1;
    this.activeJointCandidate = null;
    this.pendingJointFrames = [];
    this.jointCandidateConfidenceSums = [];
    this.jointCandidateConfidenceCounts = [];
    this.jointCandidateSelectionStartMs = null;
  }
}
