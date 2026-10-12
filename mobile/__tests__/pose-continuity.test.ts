import { PoseContinuityFilter } from '../modules/pose-tracker/src/pose-continuity';
import type { FrameResult } from '../modules/pose-tracker/src/PoseTracker.types';

function body(timestampMs: number, rotation = 0, scale = 1): FrameResult {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1, presence: 1 }));
  const set = (i: number, x: number, y: number) => {
    points[i].x = 0.5 + scale * (x * Math.cos(rotation) - y * Math.sin(rotation));
    points[i].y = 0.5 + scale * (x * Math.sin(rotation) + y * Math.cos(rotation));
  };
  set(11, -0.1, -0.2); set(12, 0.1, -0.2);
  set(23, -0.08, 0.15); set(24, 0.08, 0.15);
  return { timestampMs, poses: [points], hands: [], imageSize: { width: 1000, height: 1000 } };
}

describe('continuidade da pose sem pressupor câmera vertical', () => {
  it('rejeita a inversão real do supino em 13,264–13,990 s e recupera a orientação em 15,969 s', () => {
    // Torso coordinates from the diagnostic supplied on 2026-10-09, without image/face data.
    const samples = [
      [13102, [[0.657033, 0.340178], [0.542860, 0.286837], [0.356617, 0.421549], [0.291008, 0.394497]]],
      [13264, [[0.148797, 0.588315], [0.185531, 0.579570], [0.247055, 0.409248], [0.271304, 0.415847]]],
      [13990, [[0.154388, 0.650063], [0.166217, 0.621702], [0.318208, 0.439710], [0.315534, 0.431749]]],
      [15969, [[0.738789, 0.393518], [0.599197, 0.346222], [0.406069, 0.496547], [0.289445, 0.457430]]],
    ] as const;
    const filter = new PoseContinuityFilter();
    const results = samples.map(([timestampMs, coordinates]) => {
      const frame = body(timestampMs);
      frame.imageSize = { width: 1080, height: 1920 };
      [11, 12, 23, 24].forEach((index, i) => {
        frame.poses[0][index].x = coordinates[i][0];
        frame.poses[0][index].y = coordinates[i][1];
      });
      return filter.assess(frame).status;
    });
    expect(results).toEqual(['accepted', 'rejected', 'rejected', 'accepted']);
  });
  it.each([0, Math.PI / 2, Math.PI])('aceita a orientação inicial %s e rotações graduais', (rotation) => {
    const filter = new PoseContinuityFilter();
    for (let i = 0; i < 15; i++) {
      expect(filter.assess(body(i * 125, rotation + i * 0.1)).status).toBe('accepted');
    }
  });

  it('rejeita inversão repentina mesmo com visibility e presence altas, e recupera a pose original', () => {
    const filter = new PoseContinuityFilter();
    expect(filter.assess(body(0)).status).toBe('accepted');
    for (let t = 125; t <= 2000; t += 125) {
      expect(filter.assess(body(t, Math.PI)).status).toBe('rejected');
    }
    expect(filter.assess(body(2125)).status).toBe('accepted');
  });

  it('rejeita o encolhimento abrupto do esqueleto sem contaminar a referência', () => {
    const filter = new PoseContinuityFilter();
    filter.assess(body(0));
    expect(filter.assess(body(125, 0, 0.15)).status).toBe('rejected');
    expect(filter.assess(body(250)).status).toBe('accepted');
  });

  it('exige estabilidade para adquirir uma nova vista após uma interrupção longa', () => {
    const filter = new PoseContinuityFilter();
    filter.assess(body(0));
    expect(filter.assess(body(3500, Math.PI)).status).toBe('acquiring');
    expect(filter.assess(body(3625, Math.PI)).status).toBe('acquiring');
    expect(filter.assess(body(3875, Math.PI)).status).toBe('accepted');
  });

  it('trata ausência de pose e timestamps inválidos sem substituir a referência válida', () => {
    const filter = new PoseContinuityFilter();
    filter.assess(body(0));
    expect(filter.assess({ timestampMs: 100, poses: [], hands: [] }).status).toBe('rejected');
    expect(filter.assess(body(Number.NaN)).status).toBe('rejected');
    expect(filter.assess(body(200)).status).toBe('accepted');
  });
});
