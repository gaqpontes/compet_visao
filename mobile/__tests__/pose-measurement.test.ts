import type { FrameResult, NormalizedLandmark } from 'pose-tracker';
import { calculateAngle } from '../src/utils/biomechanics';
import { measureJoint } from '../src/utils/pose-measurement';

const point = (x: number, y: number, z = 0, visibility = 1, presence?: number): NormalizedLandmark =>
  ({ x, y, z, visibility, ...(presence === undefined ? {} : { presence }) });
const indices: [number, number, number] = [0, 1, 2];

describe('medição articular em vistas oblíquas e oclusões', () => {
  it('corrige a proporção em coordenadas de imagem antes de medir o ângulo 2D', () => {
    const frame: FrameResult = {
      timestampMs: 0, hands: [], imageSize: { width: 1920, height: 1080 },
      poses: [[point(1060 / 1920, 640 / 1080), point(0.5, 0.5), point(860 / 1920, 640 / 1080)]],
    };
    const result = measureJoint(frame, indices, false)!;
    expect(calculateAngle(...result.points)).toBeCloseTo(90);
    expect(result.space).toBe('image');
  });

  it.each([0, Math.PI / 4, Math.PI / 2])('preserva o ângulo 3D após rotação espacial de %s radianos', (rotation) => {
    const rotate = (p: NormalizedLandmark) => point(
      Math.cos(rotation) * p.x + Math.sin(rotation) * p.z,
      p.y,
      -Math.sin(rotation) * p.x + Math.cos(rotation) * p.z
    );
    const frame: FrameResult = {
      timestampMs: 0, hands: [], poses: [[point(0.4, 0.4), point(0.5, 0.5), point(0.6, 0.6)]],
      worldPoses: [[point(1, 0), point(0, 0), point(0.5, Math.sqrt(3) / 2)].map(rotate)],
    };
    const result = measureJoint(frame, indices, true)!;
    expect(result.space).toBe('world');
    expect(calculateAngle(...result.points, result.use3D)).toBeCloseTo(60);
  });

  it('aceita uma articulação oculta quando o modelo informa presença alta', () => {
    const frame: FrameResult = {
      timestampMs: 0, hands: [],
      poses: [[point(0, 1), point(0, 0, 0, 0.1, 0.9), point(1, 0)]],
    };
    expect(measureJoint(frame, indices, false)?.quality).toBe('estimated');
  });

  it('rejeita presença baixa, visibilidade baixa sem presença e geometria colapsada', () => {
    for (const middle of [point(0, 0, 0, 1, 0.1), point(0, 0, 0, 0.1), point(0, 1)]) {
      const frame: FrameResult = { timestampMs: 0, hands: [], poses: [[point(0, 1), middle, point(1, 0)]] };
      expect(measureJoint(frame, indices, false)).toBeNull();
    }
  });

  it('usa o plano da imagem como fallback e não mistura profundidade normalizada com metros', () => {
    const frame: FrameResult = { timestampMs: 0, hands: [], poses: [[point(0, 1, 50), point(0, 0), point(1, 0, -50)]] };
    const result = measureJoint(frame, indices, true)!;
    expect(result.use3D).toBe(false);
    expect(calculateAngle(...result.points, result.use3D)).toBeCloseTo(90);
  });
});
