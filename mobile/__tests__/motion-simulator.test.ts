import { generateExerciseSimulation } from '../src/utils/motion-simulator';
import { calculateAngle } from '../src/utils/biomechanics';
import { EXERCISES, getExerciseCounterOptions } from '../src/utils/exercises';
import { RepetitionCounter } from '../src/utils/repetition-counter';
import { getInclusiveSampleCount, getSampleTime } from '../modules/pose-tracker/src/video-frame-helpers';

describe('Simulador Matemático de Movimento (Vídeos Sintéticos)', () => {
  it.each([6, 8, 15, 30])('mantém a contagem da rosca direta na amostragem de %i FPS', (fps) => {
    const simulation = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 10, fps, targetReps: 5 });
    const counter = new RepetitionCounter(getExerciseCounterOptions('bicep_curl'));
    simulation.frames.forEach((frame) => counter.processFrame(frame));
    counter.finishPendingJointSelection();
    expect(counter.getRepCount()).toBe(5);
  });

  it('oferece supino reto e inclinado no catálogo com medição do cotovelo', () => {
    expect(EXERCISES.map(({ id, label }) => [id, label])).toEqual(
      expect.arrayContaining([
        ['bench_press_flat', 'Supino reto'],
        ['bench_press_incline', 'Supino inclinado'],
      ])
    );

    for (const exercise of ['bench_press_flat', 'bench_press_incline'] as const) {
      expect(getExerciseCounterOptions(exercise)).toEqual({
        jointIndices: [12, 14, 16],
        jointIndexCandidates: [
          { side: 'right', jointIndices: [12, 14, 16] },
          { side: 'left', jointIndices: [11, 13, 15] },
        ],
        endpointTolerancePercent: 20,
        minAngleThreshold: 105,
        maxAngleThreshold: 155,
        use3D: true,
        requiredPosture: exercise === 'bench_press_flat' ? 'flat' : 'incline',
        maxAngularVelocityDegPerSecond: 600,
      });
    }
  });

  it('deve gerar simulação de vídeo com duração e FPS exatos', () => {
    const durationSeconds = 4;
    const fps = 15;
    const expectedFrames = durationSeconds * fps + 1; // inclui o início e o fim do intervalo

    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds,
      fps,
      targetReps: 2,
    });

    expect(simulation.frames.length).toBe(expectedFrames);
    expect(simulation.frames[0].timestampMs).toBe(0);
    expect(simulation.frames[simulation.frames.length - 1].timestampMs).toBeCloseTo(
      (expectedFrames - 1) * (1000 / fps),
      0
    );
  });

  it('deve simular ciclo senoidal perfeito de flexão e extensão articular', () => {
    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 2, // 1 repetição completa em 2 segundos
      fps: 20,
      targetReps: 1,
      minAngle: 45,
      maxAngle: 165,
    });

    // Pega o ângulo do cotovelo em cada frame
    const elbowAngles = simulation.frames.map((frame) => {
      const pose = frame.poses[0];
      const shoulder = pose[12]; // Ombro direito
      const elbow = pose[14];    // Cotovelo direito
      const wrist = pose[16];    // Pulso direito
      return calculateAngle(shoulder, elbow, wrist);
    });

    const maxObserved = Math.max(...elbowAngles);
    const minObserved = Math.min(...elbowAngles);

    // O início e fim devem estar perto da extensão máxima
    expect(maxObserved).toBeCloseTo(165, 1);
    // O meio do movimento (pico de flexão) deve atingir o ângulo mínimo
    expect(minObserved).toBeCloseTo(45, 1);
  });

  it.each([
    ['bicep_curl', [12, 14, 16]],
    ['squat', [24, 26, 28]],
    ['pushup', [12, 14, 16]],
    ['bench_press_flat', [12, 14, 16]],
    ['bench_press_incline', [12, 14, 16]],
  ] as const)('gera o ângulo e conta repetições para %s', (exercise, indices) => {
    const simulation = generateExerciseSimulation({
      exercise,
      durationSeconds: 6,
      fps: 15,
      targetReps: 3,
      minAngle: exercise === 'squat' ? 75 : exercise.startsWith('bench_press') ? 90 : 55,
      maxAngle: 165,
    });
    const counter = new RepetitionCounter(getExerciseCounterOptions(exercise));

    simulation.frames.forEach((frame) => counter.processFrame(frame));

    expect(counter.getRepCount()).toBe(3);
    const middlePose = simulation.frames[15].poses[0];
    expect(calculateAngle(
      middlePose[indices[0]],
      middlePose[indices[1]],
      middlePose[indices[2]]
    )).toBeLessThan(getExerciseCounterOptions(exercise).maxAngleThreshold);
  });

  it.each(['bench_press_flat', 'bench_press_incline'] as const)(
    'conta repetições de %s mesmo a 6 FPS',
    (exercise) => {
      const simulation = generateExerciseSimulation({
        exercise,
        durationSeconds: 6,
        fps: 6,
        targetReps: 3,
        minAngle: 90,
        maxAngle: 165,
      });
      const counter = new RepetitionCounter(getExerciseCounterOptions(exercise));

      simulation.frames.forEach((frame) => counter.processFrame(frame));

      expect(counter.getRepCount()).toBe(3);
    }
  );

  it('deve permitir adicionar ruído aos keypoints simulando tremor de captura', () => {
    const cleanSim = generateExerciseSimulation({
      exercise: 'squat',
      durationSeconds: 1,
      fps: 10,
      targetReps: 1,
      noiseLevel: 0,
    });

    const noisySim = generateExerciseSimulation({
      exercise: 'squat',
      durationSeconds: 1,
      fps: 10,
      targetReps: 1,
      noiseLevel: 0.05, // 5% de ruído
    });

    // Os pontos com ruído devem divergir ligeiramente do traçado analítico limpo
    const cleanWrist = cleanSim.frames[5].poses[0][16];
    const noisyWrist = noisySim.frames[5].poses[0][16];

    expect(cleanWrist.x).not.toBe(noisyWrist.x);
    expect(Math.abs(cleanWrist.x - noisyWrist.x)).toBeLessThan(0.1);
  });

  it('calcula amostras inclusivas do intervalo de corte a 12 FPS', () => {
    const fps = 12;
    const startTime = 2;
    const endTime = 7;
    const sampleCount = getInclusiveSampleCount(endTime - startTime, fps);

    expect(sampleCount).toBe(61);
    expect(getSampleTime(startTime, 0, fps)).toBe(startTime);
    expect(getSampleTime(startTime, sampleCount - 1, fps)).toBeCloseTo(endTime);
  });
});
