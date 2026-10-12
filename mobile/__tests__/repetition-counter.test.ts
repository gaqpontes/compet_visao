import { RepetitionCounter } from '../src/utils/repetition-counter';
import { generateExerciseSimulation } from '../src/utils/motion-simulator';
import { getExerciseCounterOptions } from '../src/utils/exercises';

describe('Motor de Contagem de Repetições (FSM com Histerese)', () => {
  const observedFrame = (timestampMs: number, angle: number, visibility = 1) => {
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility, presence: 1 }));
    pose[12].x = 0.4;
    const radians = (180 - angle) * Math.PI / 180;
    pose[16] = { ...pose[16], x: 0.5 + 0.1 * Math.cos(radians), y: 0.5 + 0.1 * Math.sin(radians) };
    return { timestampMs, poses: [pose], hands: [], poseAssessment: { status: 'accepted' as const } };
  };
  const angularCounter = () => new RepetitionCounter({
    jointIndices: [12, 14, 16], minAngleThreshold: 80, maxAngleThreshold: 155, smoothingAlpha: 1,
  });
  const completeCycle = [160, 130, 80, 80, 100, 155, 155];

  it.each([[80, 80, 100, 155, 155], [130, 80, 80, 100, 155, 155]])(
    'ignora o primeiro movimento iniciado sem extensão observada: %j', (...partial) => {
      const counter = angularCounter();
      partial.forEach((angle, i) => counter.processFrame(observedFrame(i * 125, angle)));
      expect(counter.getRepCount()).toBe(0);
      completeCycle.forEach((angle, i) => counter.processFrame(observedFrame((partial.length + i) * 125, angle)));
      expect(counter.getRepCount()).toBe(1);
    },
  );

  it('exige nova extensão depois de reiniciar antes de contar o próximo ciclo completo', () => {
    const counter = angularCounter();
    completeCycle.forEach((angle, i) => counter.processFrame(observedFrame(i * 125, angle)));
    expect(counter.getRepCount()).toBe(1);
    counter.reset();
    [80, 80, 100, 155, 155].forEach((angle, i) => counter.processFrame(observedFrame(i * 125, angle)));
    expect(counter.getRepCount()).toBe(0);
    completeCycle.forEach((angle, i) => counter.processFrame(observedFrame(625 + i * 125, angle)));
    expect(counter.getRepCount()).toBe(1);
  });

  it('não completa um ciclo quando o rastreamento retorna embaixo após uma lacuna longa', () => {
    const counter = angularCounter();
    [160, 130, 80, 80].forEach((angle, i) => counter.processFrame(observedFrame(i * 125, angle)));
    counter.processFrame({ timestampMs: 500, poses: [], hands: [] });
    [80, 80, 100, 155, 155].forEach((angle, i) => counter.processFrame(observedFrame(800 + i * 125, angle)));
    expect(counter.getRepCount()).toBe(0);
    completeCycle.forEach((angle, i) => counter.processFrame(observedFrame(1425 + i * 125, angle)));
    expect(counter.getRepCount()).toBe(1);
  });

  it('não usa uma extensão estimada de articulação oculta para armar a contagem', () => {
    const counter = angularCounter();
    counter.processFrame(observedFrame(0, 160, 0.1));
    expect(counter.getAngleQuality()).toBe('estimated');
    [130, 80, 80, 100, 155, 155].forEach((angle, i) => counter.processFrame(observedFrame(125 + i * 125, angle)));
    expect(counter.getRepCount()).toBe(0);
    completeCycle.forEach((angle, i) => counter.processFrame(observedFrame(875 + i * 125, angle)));
    expect(counter.getRepCount()).toBe(1);
  });

  it('mantém a contagem por trajetória do punho sem extensão visível do cotovelo', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16], minAngleThreshold: 80, maxAngleThreshold: 155, benchWristTravel: true,
    });
    for (let i = 0; i <= 72; i++) {
      const frame = observedFrame(i * 125, 160);
      const elevation = 0.6 + 0.4 * Math.cos(2 * Math.PI * i / 24);
      frame.poses[0][16].y = 0.5 + 0.1 * elevation;
      frame.poses[0][14].visibility = 0;
      frame.poses[0][14].presence = 0;
      counter.processFrame(frame);
    }
    expect(counter.hasCurrentAngle()).toBe(false);
    expect(counter.getRepCount()).toBe(3);
  });

  it('registra apenas repetições completas e limpa seus intervalos ao reiniciar', () => {
    const counter = new RepetitionCounter({ jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145 });
    const { frames } = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 2, fps: 15, targetReps: 1 });
    frames.forEach((frame) => counter.processFrame(frame));
    expect(counter.getCompletedRepetitions()).toHaveLength(1);
    const first = counter.getCompletedRepetitions()[0];
    expect(first.startTimestampMs).toBeLessThan(first.endTimestampMs);
    expect(first.endTimestampMs).toBeLessThanOrEqual(2000);
    counter.reset();
    expect(counter.getCompletedRepetitions()).toEqual([]);
    frames.forEach((frame) => counter.processFrame(frame));
    expect(counter.getCompletedRepetitions()).toEqual([first]);
  });
  it('preserva o movimento durante uma oscilação isolada da postura, mas rejeita saída sustentada', () => {
    const run = (sustained: boolean) => {
      const counter = new RepetitionCounter({
        jointIndices: [12, 14, 16], minAngleThreshold: 105, maxAngleThreshold: 155,
        requiredPosture: 'flat', smoothingAlpha: 1,
      });
      const { frames } = generateExerciseSimulation({ exercise: 'bench_press_flat', durationSeconds: 4, fps: 10, targetReps: 1 });
      for (const frame of frames) {
        if (frame.timestampMs === 3000 || (sustained && frame.timestampMs > 3000)) {
          const p = frame.poses[0];
          const dx = (p[11].x + p[12].x - p[23].x - p[24].x) / 2;
          const dy = (p[11].y + p[12].y - p[23].y - p[24].y) / 2;
          for (const [knee, ankle] of [[25, 27], [26, 28]]) p[ankle] = { ...p[ankle], x: p[knee].x + dx, y: p[knee].y + dy };
        }
        counter.processFrame(frame);
      }
      return counter.getRepCount();
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });
  it('inicia a permanência no primeiro quadro do extremo, sem exigir um terceiro quadro a 8 FPS', () => {
    const counter = new RepetitionCounter({ jointIndices: [12, 14, 16], minAngleThreshold: 105, maxAngleThreshold: 155, smoothingAlpha: 1, endpointDwellMs: 100 });
    [160, 105, 109, 118, 150, 155].forEach((angle, index) => {
      const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
      pose[12].x = 0.4;
      const rad = (180 - angle) * Math.PI / 180;
      pose[16] = { x: 0.5 + 0.1 * Math.cos(rad), y: 0.5 + 0.1 * Math.sin(rad), z: 0, visibility: 1 };
      counter.processFrame({ timestampMs: index * 125, poses: [pose], hands: [] });
    });
    expect(counter.getRepCount()).toBe(1);
  });
  it('não conta movimentos do braço sentado quando o exercício exige supino', () => {
    const counter = new RepetitionCounter(getExerciseCounterOptions('bench_press_flat'));
    const seated = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 6, fps: 15, targetReps: 3, minAngle: 80 });
    seated.frames.forEach((frame) => counter.processFrame(frame));
    expect(counter.getPostureAssessment().state).toBe('no');
    expect(counter.getRepCount()).toBe(0);
    expect(counter.getActiveJointSide()).toBeNull();
  });

  it('rejeita um salto angular em alta confiança e recupera uma leitura coerente', () => {
    const counter = new RepetitionCounter({ jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145, maxAngularVelocityDegPerSecond: 600 });
    const frames = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 4, fps: 30, targetReps: 1 }).frames;
    counter.processFrame(frames[0]);
    counter.processFrame(frames[1]);
    const outlier = { ...frames[60], timestampMs: frames[2].timestampMs };
    counter.processFrame(outlier);
    expect(counter.hasCurrentAngle()).toBe(false);
    expect(counter.getPoseAssessment().reason).toBe('joint-jump');
    counter.processFrame(frames[3]);
    expect(counter.hasCurrentAngle()).toBe(true);
    expect(counter.getCurrentAngle()).toBeGreaterThan(150);
    expect(counter.getRepCount()).toBe(0);
  });
  it('conta em 3D com oclusões curtas entre os extremos e câmera oblíqua', () => {
    const counter = new RepetitionCounter({ jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145, use3D: true });
    const simulation = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 6, fps: 15, targetReps: 3 });
    simulation.frames.forEach((frame) => {
      const world = frame.poses[0].map((p) => ({ ...p, x: p.x * 0.5, z: p.x * Math.sqrt(3) / 2 }));
      const phaseMs = frame.timestampMs % 2000;
      frame.poses[0].forEach((p) => { p.x *= 0.5; p.visibility = phaseMs >= 400 && phaseMs <= 500 ? 0.1 : 0.99; p.presence = 0.95; });
      counter.processFrame({ ...frame, worldPoses: [world] });
    });
    expect(counter.getRepCount()).toBe(3);
    expect(counter.getAngleQuality()).toBe('observed');
    expect(counter.getMeasurementSpace()).toBe('world');
  });

  it('não conta extremos produzidos inteiramente por articulações ocultas', () => {
    const counter = new RepetitionCounter({ jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145 });
    generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 6, fps: 15, targetReps: 3 }).frames.forEach((frame) => {
      frame.poses[0].forEach((p) => { p.visibility = 0.1; p.presence = 0.99; });
      counter.processFrame(frame);
    });
    expect(counter.getRepCount()).toBe(0);
    expect(counter.hasCurrentAngle()).toBe(false);
  });

  it('não escolhe um lado durante a abertura do vídeo sem pessoa', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      jointIndexCandidates: [{ side: 'right', jointIndices: [12, 14, 16] }, { side: 'left', jointIndices: [11, 13, 15] }],
      minAngleThreshold: 60, maxAngleThreshold: 145,
    });
    for (let timestampMs = 0; timestampMs <= 2000; timestampMs += 125) counter.processFrame({ timestampMs, poses: [], hands: [] });
    expect(counter.getActiveJointSide()).toBeNull();
  });

  it('troca para o lado confiável após oclusão sustentada, sem juntar movimentos de braços diferentes', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      jointIndexCandidates: [{ side: 'right', jointIndices: [12, 14, 16] }, { side: 'left', jointIndices: [11, 13, 15] }],
      jointCandidateSelectionDurationMs: 0,
      minAngleThreshold: 60, maxAngleThreshold: 145,
    });
    const simulation = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 4, fps: 10, targetReps: 2 });
    simulation.frames.forEach((frame, index) => {
      const pose = frame.poses[0];
      [11, 13, 15].forEach((left, i) => { pose[left] = { ...pose[[12, 14, 16][i]], visibility: index < 5 ? 0.5 : 1 }; });
      if (index >= 5) [12, 14, 16].forEach((right) => { pose[right].visibility = 0; });
      counter.processFrame(frame);
      if (index === 6) expect(counter.getActiveJointSide()).toBe('right');
    });
    expect(counter.getActiveJointSide()).toBe('left');
    expect(counter.getRepCount()).toBeLessThanOrEqual(2);
  });

  it('rejeita um segmento bruto colapsado mesmo quando o EMA anterior tinha geometria válida', () => {
    const counter = new RepetitionCounter({ jointIndices: [12, 14, 16], minAngleThreshold: 60, maxAngleThreshold: 145 });
    const simulation = generateExerciseSimulation({ exercise: 'bicep_curl', durationSeconds: 2, fps: 8, targetReps: 1 });
    counter.processFrame(simulation.frames[0]);
    const collapsed = simulation.frames[1];
    collapsed.poses[0][12] = { ...collapsed.poses[0][14] };
    collapsed.poses[0][16] = { ...collapsed.poses[0][14] };
    counter.processFrame(collapsed);
    expect(counter.hasCurrentAngle()).toBe(false);
    expect(counter.getAngleQuality()).toBe('unavailable');
  });

  it('deve contar com precisão 5 repetições completas geradas pela simulação matemática', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16], // Ombro, Cotovelo, Pulso direito
      minAngleThreshold: 60,      // Flexão máxima
      maxAngleThreshold: 145,     // Extensão completa
    });

    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 10,
      fps: 15,
      targetReps: 5,
      minAngle: 45,
      maxAngle: 160,
    });

    for (const frame of simulation.frames) {
      counter.processFrame(frame);
      counter.processFrame(frame); // timestamps repetidos não podem duplicar a contagem
    }

    expect(counter.getRepCount()).toBe(5);
  });

  it('não expõe um ângulo atual válido para um timestamp repetido', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      minAngleThreshold: 60,
      maxAngleThreshold: 145,
    });
    const frame = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 2,
      fps: 10,
      targetReps: 1,
    }).frames[0];

    counter.processFrame(frame);
    expect(counter.hasCurrentAngle()).toBe(true);
    counter.processFrame(frame);
    expect(counter.hasCurrentAngle()).toBe(false);
    expect(counter.getRepCount()).toBe(0);
  });

  it('não deve contar repetições incompletas (movimento sem amplitude)', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      minAngleThreshold: 60,
      maxAngleThreshold: 145,
    });

    // Simulação que desce apenas até 100 graus (meio movimento, não atinge 60)
    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 6,
      fps: 15,
      targetReps: 3,
      minAngle: 100, // não atinge o limiar de 60
      maxAngle: 160,
    });

    for (const frame of simulation.frames) {
      counter.processFrame(frame);
    }

    expect(counter.getRepCount()).toBe(0);
  });

  it('deve filtrar ruído e micro-tremores através da histerese', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      minAngleThreshold: 60,
      maxAngleThreshold: 145,
    });

    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 6,
      fps: 15,
      targetReps: 3,
      minAngle: 50,
      maxAngle: 155,
      noiseLevel: 0.08, // Tremor significativo
    });

    for (const frame of simulation.frames) {
      counter.processFrame(frame);
    }

    // Mesmo com ruído de 8%, deve identificar com precisão as 3 repetições
    expect(counter.getRepCount()).toBe(3);
  });

  it('ignora pontos invisíveis ou segmentos colapsados em vez de contar ângulo zero', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      minAngleThreshold: 60,
      maxAngleThreshold: 145,
    });
    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 4,
      fps: 15,
      targetReps: 2,
    });

    for (const frame of simulation.frames) {
      const pose = frame.poses[0];
      pose[14].visibility = 0;
      counter.processFrame(frame);
    }
    expect(counter.getRepCount()).toBe(0);
    expect(counter.hasCurrentAngle()).toBe(false);

    counter.reset();
    for (const frame of simulation.frames) {
      const pose = frame.poses[0];
      pose[14] = { ...pose[14], visibility: 0.99 };
      pose[12] = { ...pose[14] };
      pose[16] = { ...pose[14] };
      counter.processFrame(frame);
    }
    expect(counter.getRepCount()).toBe(0);
    expect(counter.hasCurrentAngle()).toBe(false);
  });

  it('deve calcular a porcentagem de completude da repetição em tempo real (0 a 100%)', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      minAngleThreshold: 50,
      maxAngleThreshold: 150,
    });

    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 2,
      fps: 20,
      targetReps: 1,
      minAngle: 50,
      maxAngle: 150,
    });

    // No frame inicial (extensão total), o progresso deve ser 0%
    counter.processFrame(simulation.frames[0]);
    expect(counter.hasCurrentAngle()).toBe(true);
    expect(counter.getCurrentRepProgress()).toBeCloseTo(0, 0);

    // No meio do movimento (frame 20 de 40, exatamente metade do ciclo de 2 segundos)
    for (let i = 1; i <= 20; i++) {
      counter.processFrame(simulation.frames[i]);
    }
    expect(counter.getCurrentRepProgress()).toBeGreaterThanOrEqual(90);
  });

  it('escolhe o lado mais visível na janela inicial, não pelo primeiro quadro', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      jointIndexCandidates: [
        { side: 'right', jointIndices: [12, 14, 16] },
        { side: 'left', jointIndices: [11, 13, 15] },
      ],
      minAngleThreshold: 105,
      maxAngleThreshold: 155,
    });
    const simulation = generateExerciseSimulation({
      exercise: 'bicep_curl',
      durationSeconds: 8,
      fps: 15,
      targetReps: 3,
      minAngle: 95,
      maxAngle: 170,
    });

    simulation.frames.forEach((frame, frameIndex) => {
      const pose = frame.poses[0];
      // O braço direito parece ótimo no primeiro quadro, mas fica oculto no restante da janela.
      pose[11] = { ...pose[12], visibility: frameIndex === 0 ? 0.4 : 0.95 };
      pose[13] = { ...pose[14], visibility: frameIndex === 0 ? 0.4 : 0.95 };
      pose[15] = { ...pose[16], visibility: frameIndex === 0 ? 0.4 : 0.95 };
      const rightVisibility = frameIndex === 0 ? 0.99 : 0.1;
      pose[12] = { ...pose[12], visibility: rightVisibility };
      pose[14] = { ...pose[14], visibility: rightVisibility };
      pose[16] = { ...pose[16], visibility: rightVisibility };
      counter.processFrame(frame);
    });
    counter.finishPendingJointSelection();

    expect(counter.getActiveJointSide()).toBe('left');
    expect(counter.getRepCount()).toBe(3);
  });

  it('preserva a confirmação do extremo durante quadros sem pose isolados', () => {
    const counter = new RepetitionCounter({
      jointIndices: [12, 14, 16],
      minAngleThreshold: 105,
      maxAngleThreshold: 155,
      endpointDwellMs: 100,
      smoothingAlpha: 1,
    });
    const frameAtAngle = (timestampMs: number, angle: number) => {
      const point = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
      const pose = Array.from({ length: 33 }, () => point(0.5, 0.5));
      pose[12] = point(0.4, 0.5);
      pose[14] = point(0.5, 0.5);
      const direction = ((180 - angle) * Math.PI) / 180;
      pose[16] = point(0.5 + 0.1 * Math.cos(direction), 0.5 + 0.1 * Math.sin(direction));
      return { timestampMs, poses: [pose], hands: [] };
    };

    [
      frameAtAngle(0, 160),
      frameAtAngle(100, 140),
      frameAtAngle(150, 105),
      { timestampMs: 200, poses: [], hands: [] },
      frameAtAngle(250, 105),
      frameAtAngle(300, 120),
      frameAtAngle(350, 150),
      { timestampMs: 400, poses: [], hands: [] },
      frameAtAngle(450, 150),
    ].forEach((frame) => counter.processFrame(frame));

    expect(counter.getRepCount()).toBe(1);
  });
});
