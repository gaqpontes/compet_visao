import { FrameResult, NormalizedLandmark, HandLandmarkResult } from 'pose-tracker';
import { EXERCISES, ExerciseType } from './exercises';

export type SimulationOptions = {
  exercise: ExerciseType;
  durationSeconds: number;
  fps: number;
  targetReps: number;
  minAngle?: number; // Pico de flexão (padrão: 45)
  maxAngle?: number; // Extensão máxima (padrão: 165)
  noiseLevel?: number; // ruído relativo ao comprimento do segmento, 0.05 = 5%
  seed?: number; // semente para simulações reproduzíveis
};

export type SimulationResult = {
  frames: FrameResult[];
  timestamps: number[];
  reps: number;
  fps: number;
};

function createRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Cria um esqueleto base de 33 landmarks do MediaPipe Pose em posição neutra.
 */
function createBaseSkeleton(): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = [];
  for (let i = 0; i < 33; i++) {
    landmarks.push({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0.99,
    });
  }

  // Posições base realistas
  landmarks[0] = { x: 0.5, y: 0.15, z: 0, visibility: 0.99 }; // Nariz
  landmarks[11] = { x: 0.42, y: 0.3, z: 0, visibility: 0.99 }; // Ombro esquerdo
  landmarks[12] = { x: 0.58, y: 0.3, z: 0, visibility: 0.99 }; // Ombro direito
  landmarks[13] = { x: 0.4, y: 0.5, z: 0, visibility: 0.99 }; // Cotovelo esquerdo
  landmarks[14] = { x: 0.6, y: 0.5, z: 0, visibility: 0.99 }; // Cotovelo direito
  landmarks[15] = { x: 0.4, y: 0.7, z: 0, visibility: 0.99 }; // Pulso esquerdo
  landmarks[16] = { x: 0.6, y: 0.7, z: 0, visibility: 0.99 }; // Pulso direito
  landmarks[23] = { x: 0.45, y: 0.6, z: 0, visibility: 0.99 }; // Quadril esquerdo
  landmarks[24] = { x: 0.55, y: 0.6, z: 0, visibility: 0.99 }; // Quadril direito
  landmarks[25] = { x: 0.45, y: 0.8, z: 0, visibility: 0.99 }; // Joelho esquerdo
  landmarks[26] = { x: 0.55, y: 0.8, z: 0, visibility: 0.99 }; // Joelho direito
  landmarks[27] = { x: 0.45, y: 0.95, z: 0, visibility: 0.99 }; // Tornozelo esquerdo
  landmarks[28] = { x: 0.55, y: 0.95, z: 0, visibility: 0.99 }; // Tornozelo direito

  return landmarks;
}

/**
 * Simulador Matemático de Movimento Humano para Exercícios.
 * Utiliza osciladores harmônicos periódicos para gerar séries temporais de landmarks.
 */
export function generateExerciseSimulation(options: SimulationOptions): SimulationResult {
  const {
    durationSeconds,
    fps,
    targetReps,
    minAngle = 45,
    maxAngle = 165,
    noiseLevel = 0,
    seed = 12345,
  } = options;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('A duração e a taxa de quadros devem ser maiores que zero.');
  }
  if (!Number.isInteger(targetReps) || targetReps <= 0) {
    throw new Error('O número de repetições deve ser um inteiro positivo.');
  }
  if (
    !EXERCISES.some(({ id }) => id === options.exercise) ||
    !Number.isFinite(minAngle) ||
    !Number.isFinite(maxAngle) ||
    minAngle < 0 ||
    maxAngle > 180 ||
    minAngle >= maxAngle ||
    !Number.isFinite(noiseLevel) ||
    noiseLevel < 0
  ) {
    throw new Error('Os parâmetros do exercício, ângulo ou ruído são inválidos.');
  }

  // Amostra o instante inicial e o final para representar ciclos completos.
  const totalFrames = Math.floor(durationSeconds * fps + 1e-9) + 1;
  const frames: FrameResult[] = [];
  const timestamps: number[] = [];

  const armLength = 0.2; // Comprimento do antebraço
  const legLength = 0.2;
  const random = createRandom(seed);
  const omega = (2 * Math.PI * targetReps) / durationSeconds; // Frequência angular

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    const timestampMs = Math.round(t * 1000);
    timestamps.push(timestampMs);

    // Oscilação senoidal harmônica: no início (t=0), ângulo = maxAngle (estendido)
    const angle =
      (minAngle + maxAngle) / 2 + ((maxAngle - minAngle) / 2) * Math.cos(omega * t);

    const skeleton = createBaseSkeleton();

    const thetaRad = (angle * Math.PI) / 180;
    if (options.exercise === 'squat') {
      const hip = skeleton[24];
      const knee = skeleton[26];
      const ankle = skeleton[28];
      knee.x = hip.x;
      knee.y = hip.y + legLength;
      ankle.x = knee.x + legLength * Math.sin(Math.PI - thetaRad);
      ankle.y = knee.y + legLength * Math.cos(Math.PI - thetaRad);
    } else if (options.exercise === 'pushup' || options.exercise === 'bench_press_flat') {
      // Esqueleto horizontal, com a flexão sendo medida no cotovelo.
      const shoulder = skeleton[12];
      const elbow = skeleton[14];
      shoulder.x = options.exercise === 'bench_press_flat' ? 0.24 : 0.28;
      shoulder.y = options.exercise === 'bench_press_flat' ? 0.48 : 0.55;
      elbow.x = shoulder.x + armLength;
      elbow.y = shoulder.y;
      skeleton[16] = {
        x: elbow.x + armLength * Math.cos(Math.PI - thetaRad),
        y: elbow.y + armLength * Math.sin(Math.PI - thetaRad),
        z: 0,
        visibility: 0.99,
      };
    } else if (options.exercise === 'bench_press_incline') {
      // Inclina o braço superior; a articulação contada continua sendo o cotovelo.
      const shoulder = skeleton[12];
      const elbow = skeleton[14];
      shoulder.x = 0.24;
      shoulder.y = 0.56;
      elbow.x = shoulder.x + armLength * Math.cos(Math.PI / 6);
      elbow.y = shoulder.y - armLength * Math.sin(Math.PI / 6);
      const shoulderToElbowAngle = Math.atan2(elbow.y - shoulder.y, elbow.x - shoulder.x);
      const wristAngle = shoulderToElbowAngle + Math.PI - thetaRad;
      skeleton[16] = {
        x: elbow.x + armLength * Math.cos(wristAngle),
        y: elbow.y + armLength * Math.sin(wristAngle),
        z: 0,
        visibility: 0.99,
      };
    } else {
      const shoulder = skeleton[12];
      const elbow = skeleton[14];
      elbow.x = shoulder.x;
      elbow.y = shoulder.y + armLength;
      skeleton[16] = {
        x: elbow.x + armLength * Math.sin(Math.PI - thetaRad),
        y: elbow.y + armLength * Math.cos(Math.PI - thetaRad),
        z: 0,
        visibility: 0.99,
      };
    }

    if (options.exercise.startsWith('bench_press')) {
      // The posture gate needs a complete torso and supported lower legs, not only an elbow.
      const shoulder = skeleton[12];
      skeleton[11] = { ...shoulder, y: shoulder.y - 0.04 };
      const hipY = options.exercise === 'bench_press_flat' ? shoulder.y : 0.8;
      skeleton[23] = { x: 0.65, y: hipY - 0.04, z: 0, visibility: 0.99 };
      skeleton[24] = { x: 0.65, y: hipY, z: 0, visibility: 0.99 };
      for (const [knee, ankle, x] of [[25, 27, 0.7], [26, 28, 0.8]]) {
        skeleton[knee] = { x, y: 0.7, z: 0, visibility: 0.99 };
        skeleton[ankle] = { x, y: 0.95, z: 0, visibility: 0.99 };
      }
    }

    // Aplicação de ruído pseudo-gaussiano se configurado
    if (noiseLevel > 0) {
      for (const lm of skeleton) {
        const sampleNormal = () => {
          const u1 = Math.max(0.0001, random());
          const u2 = random();
          return Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
        };

        lm.x += sampleNormal() * noiseLevel * armLength;
        lm.y += sampleNormal() * noiseLevel * armLength;
      }
    }

    // Mãos simuladas conectadas ao pulso
    const hands: HandLandmarkResult[] = [
      {
        handedness: 'Right',
        landmarks: Array.from({ length: 21 }, (_, hIdx) => ({
          x: skeleton[16].x + (hIdx * 0.002 - 0.02),
          y: skeleton[16].y + (hIdx * 0.002 - 0.02),
          z: 0,
        })),
      },
    ];

    frames.push({
      timestampMs,
      poses: [skeleton],
      hands,
    });
  }

  return {
    frames,
    timestamps,
    reps: targetReps,
    fps,
  };
}
