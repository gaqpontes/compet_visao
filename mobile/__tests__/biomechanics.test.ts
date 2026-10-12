import { calculateAngle, calculateDistance, getTemporalSmoothingAlpha, smoothLandmarks } from '../src/utils/biomechanics';
import { NormalizedLandmark } from 'pose-tracker';

describe('Matemática Biomecânica (Cinemática Angular)', () => {
  it('preserva a mesma constante temporal de suavização ao reduzir o FPS', () => {
    const alpha = 0.45;
    expect(getTemporalSmoothingAlpha(alpha, 1000 / 15)).toBeCloseTo(alpha);
    expect(getTemporalSmoothingAlpha(alpha, 2000 / 15)).toBeCloseTo(1 - (1 - alpha) ** 2);
    expect(getTemporalSmoothingAlpha(alpha, 1000 / 6)).toBeGreaterThan(alpha);
    expect(getTemporalSmoothingAlpha(1, 125)).toBe(1);
    expect(getTemporalSmoothingAlpha(0, 125)).toBe(0);
  });

  it('deve calcular ângulo reto exato de 90 graus', () => {
    // Ponto B é a articulação (ex: cotovelo na origem)
    const shoulder: NormalizedLandmark = { x: 0, y: 1, z: 0 };
    const elbow: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    const wrist: NormalizedLandmark = { x: 1, y: 0, z: 0 };

    const angle = calculateAngle(shoulder, elbow, wrist);
    expect(angle).toBeCloseTo(90, 1);
  });

  it('deve calcular ângulo raso de 180 graus (braço totalmente estendido)', () => {
    const shoulder: NormalizedLandmark = { x: 0, y: 1, z: 0 };
    const elbow: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    const wrist: NormalizedLandmark = { x: 0, y: -1, z: 0 };

    const angle = calculateAngle(shoulder, elbow, wrist);
    expect(angle).toBeCloseTo(180, 1);
  });

  it('deve calcular ângulo agudo de 45 graus (flexão de articulação)', () => {
    const shoulder: NormalizedLandmark = { x: 0, y: 1, z: 0 };
    const elbow: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    const wrist: NormalizedLandmark = { x: 1, y: 1, z: 0 };

    const angle = calculateAngle(shoulder, elbow, wrist);
    expect(angle).toBeCloseTo(45, 1);
  });

  it('calcula ângulos 3D quando a profundidade é solicitada', () => {
    const pointA: NormalizedLandmark = { x: 0, y: 0, z: 1 };
    const joint: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    const pointC: NormalizedLandmark = { x: 1, y: 0, z: 0 };

    expect(calculateAngle(pointA, joint, pointC)).toBe(0);
    expect(calculateAngle(pointA, joint, pointC, true)).toBeCloseTo(90, 1);
  });

  it('deve ser tolerante a singularidades e pontos coincidentes sem retornar NaN', () => {
    const p1: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    const p2: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    const p3: NormalizedLandmark = { x: 1, y: 0, z: 0 };

    const angle = calculateAngle(p1, p2, p3);
    expect(isNaN(angle)).toBe(false);
    expect(angle).toBe(0);
  });

  it('deve calcular a distância euclidiana entre dois keypoints', () => {
    const p1: NormalizedLandmark = { x: 0, y: 0, z: 0 };
    const p2: NormalizedLandmark = { x: 3, y: 4, z: 0 };

    const dist = calculateDistance(p1, p2);
    expect(dist).toBeCloseTo(5, 4);
  });

  it('deve filtrar e suavizar ruído temporal em keypoints usando média exponencial móvel', () => {
    const prev: NormalizedLandmark = { x: 0.5, y: 0.5, z: 0 };
    const rawNoise: NormalizedLandmark = { x: 0.6, y: 0.5, z: 0 };

    // Com alpha = 0.5, o resultado deve ser 0.55
    const smoothed = smoothLandmarks([prev], [rawNoise], 0.5);
    expect(smoothed[0].x).toBeCloseTo(0.55, 3);
    expect(smoothed[0].y).toBeCloseTo(0.5, 3);
  });

  it('limita o peso EMA ao intervalo válido de 0 a 1', () => {
    const previous: NormalizedLandmark = { x: 0.5, y: 0.5, z: 0 };
    const current: NormalizedLandmark = { x: 0.8, y: 0.8, z: 0 };

    expect(smoothLandmarks([previous], [current], 2)[0].x).toBeCloseTo(0.8);
    expect(smoothLandmarks([previous], [current], -1)[0].x).toBeCloseTo(0.5);
  });
});
