import { findTimelineIndex, getAngleSegments } from '../src/utils/analysis-plot';
import { buildCounterTimeline } from '../src/utils/counter-timeline';
import { generateExerciseSimulation } from '../src/utils/motion-simulator';

it('seleciona o instante mais próximo nos limites e entre amostras irregulares', () => {
  const frames = [1000, 1125, 1370].map((timestampMs) => ({ timestampMs }));
  expect(findTimelineIndex(frames, -1)).toBe(0);
  expect(findTimelineIndex(frames, 1200)).toBe(1);
  expect(findTimelineIndex(frames, 1330)).toBe(2);
  expect(findTimelineIndex(frames, 9999)).toBe(2);
  expect(findTimelineIndex([], 0)).toBe(-1);
});

it('interrompe a curva quando não existe leitura para não inventar um movimento', () => {
  const frames = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 2, fps: 8, targetReps: 1 }).frames;
  frames[5] = { ...frames[5], poses: [] };
  const { snapshots } = buildCounterTimeline(frames, { jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145 });
  const segments = getAngleSegments(frames, snapshots);
  expect(segments).toHaveLength(2);
  expect(segments[0][segments[0].length - 1].timestampMs).toBe(500);
  expect(segments[1][0].timestampMs).toBe(750);
});
