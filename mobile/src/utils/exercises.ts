import { DEFAULT_ENDPOINT_TOLERANCE_PERCENT } from './endpoint-tolerance';
import { RepetitionCounterOptions } from './repetition-counter';

export type ExerciseType =
  | 'bicep_curl'
  | 'squat'
  | 'pushup'
  | 'bench_press_flat'
  | 'bench_press_incline';

export const EXERCISES: { id: ExerciseType; label: string }[] = [
  { id: 'bicep_curl', label: 'Rosca direta' },
  { id: 'squat', label: 'Agachamento' },
  { id: 'pushup', label: 'Flexão' },
  { id: 'bench_press_flat', label: 'Supino reto' },
  { id: 'bench_press_incline', label: 'Supino inclinado' },
];

const EXERCISE_COUNTERS: Record<ExerciseType, RepetitionCounterOptions> = {
  bicep_curl: {
    jointIndices: [12, 14, 16],
    jointIndexCandidates: [
      { side: 'right', jointIndices: [12, 14, 16] },
      { side: 'left', jointIndices: [11, 13, 15] },
    ],
    minAngleThreshold: 60,
    maxAngleThreshold: 145,
  },
  squat: {
    jointIndices: [24, 26, 28],
    jointIndexCandidates: [
      { side: 'right', jointIndices: [24, 26, 28] },
      { side: 'left', jointIndices: [23, 25, 27] },
    ],
    minAngleThreshold: 95,
    maxAngleThreshold: 160,
  },
  pushup: {
    jointIndices: [12, 14, 16],
    jointIndexCandidates: [
      { side: 'right', jointIndices: [12, 14, 16] },
      { side: 'left', jointIndices: [11, 13, 15] },
    ],
    minAngleThreshold: 80,
    maxAngleThreshold: 155,
  },
  bench_press_flat: {
    requiredPosture: 'flat',
    jointIndices: [12, 14, 16],
    jointIndexCandidates: [
      { side: 'right', jointIndices: [12, 14, 16] },
      { side: 'left', jointIndices: [11, 13, 15] },
    ],
    minAngleThreshold: 105,
    maxAngleThreshold: 155,
  },
  bench_press_incline: {
    requiredPosture: 'incline',
    jointIndices: [12, 14, 16],
    jointIndexCandidates: [
      { side: 'right', jointIndices: [12, 14, 16] },
      { side: 'left', jointIndices: [11, 13, 15] },
    ],
    minAngleThreshold: 105,
    maxAngleThreshold: 155,
  },
};

export function getExerciseCounterOptions(exercise: ExerciseType): RepetitionCounterOptions {
  return { ...EXERCISE_COUNTERS[exercise], endpointTolerancePercent: DEFAULT_ENDPOINT_TOLERANCE_PERCENT, use3D: true, maxAngularVelocityDegPerSecond: 600 };
}
