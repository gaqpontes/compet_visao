import { buildCounterTimeline } from '../src/utils/counter-timeline';
import { generateExerciseSimulation } from '../src/utils/motion-simulator';

it('mantém ângulo e contagem do timestamp consultado, inclusive voltando no vídeo', () => {
  const frames = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 6, fps: 15, targetReps: 3 }).frames;
  const { snapshots, repetitions } = buildCounterTimeline(frames, { jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145 });
  expect(snapshots.get(6000)?.reps).toBe(3);
  expect(snapshots.get(0)?.reps).toBe(0);
  expect(snapshots.get(1000)?.angle).toBeLessThan(80);
  expect(snapshots.get(0)?.angle).toBeGreaterThan(150);
  expect(repetitions).toHaveLength(3);
  repetitions.forEach((rep, index) => {
    expect(rep.index).toBe(index + 1);
    expect(rep.startTimestampMs).toBeLessThan(rep.endTimestampMs);
    expect(snapshots.get(rep.endTimestampMs)?.reps).toBe(index + 1);
    expect(snapshots.get(rep.startTimestampMs)?.reps).toBe(index);
    if (index > 0) expect(rep.startTimestampMs).toBeGreaterThan(repetitions[index - 1].endTimestampMs);
  });
});

it('oculta a pose rejeitada sem apagar os landmarks originais do diagnóstico', () => {
  const frame = { timestampMs: 0, poses: [[{ x: 0.5, y: 0.5, z: 0 }]], hands: [],
    poseAssessment: { status: 'rejected' as const, reason: 'body-flip' as const } };
  const { snapshots, displayFrames } = buildCounterTimeline([frame], { jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145 });
  expect(displayFrames[0].poses).toEqual([]);
  expect(frame.poses).toHaveLength(1);
  expect(snapshots.get(0)?.pose).toBe('no');
  expect(snapshots.get(0)?.flexed).toBe('unknown');
});

it('não atribui ao último quadro vazio um ângulo antigo da seleção de lado', () => {
  const frames = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 1, fps: 8, targetReps: 1 }).frames.slice(0, 3);
  frames[2] = { ...frames[2], poses: [] };
  const { snapshots } = buildCounterTimeline(frames, {
    jointIndices: [12, 14, 16], jointIndexCandidates: [{ side: 'right', jointIndices: [12, 14, 16] }],
    minAngleThreshold: 60, maxAngleThreshold: 145,
  });
  expect(snapshots.get(250)?.quality).toBe('unavailable');
  expect(snapshots.get(250)?.flexed).toBe('unknown');
});
