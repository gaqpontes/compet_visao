import type { FrameResult } from 'pose-tracker';
import type { CounterSnapshot } from '../src/utils/counter-timeline';
import { assessVideo } from '../src/utils/video-assessment';

const options = { jointIndices: [12, 14, 16] as [number, number, number], minAngleThreshold: 80, maxAngleThreshold: 155 };
function recording(angles = Array.from({length: 49}, (_, i) => 120 + 45 * Math.cos(i * Math.PI / 12))) {
  const frames: FrameResult[] = angles.map((_, i) => ({ timestampMs: i * 125, poses: [Array.from({length: 33}, () => ({x: 0.5, y: 0.5, z: 0, visibility: 1}))], hands: [] }));
  const snapshots = new Map<number, CounterSnapshot>(frames.map((f, i) => [f.timestampMs, {
    reps: 0, angle: angles[i], progress: 0, quality: 'observed', space: 'world', side: 'right',
    posture: {state: 'yes', label: 'Compatível'}, pose: 'yes', flexed: 'unknown', extended: 'unknown', phase: 'EXTENDED',
  }]));
  return { frames, snapshots };
}
const codes = (result: ReturnType<typeof assessVideo>) => result.findings.map(f => f.code);

it('qualifica uma leitura consistente sem chamar a execução de correta', () => {
  const { frames, snapshots } = recording();
  const result = assessVideo(frames, snapshots, options, 2);
  expect(result.status).toBe('adequate'); expect(result.repetitions).toBe(2);
  expect(result.title).toBe('Adequado para análise'); expect(result.note).toContain('não da técnica');
});
it('reconhece movimento sem extremos confirmados, sem afirmar falta real de amplitude', () => {
  const { frames, snapshots } = recording(); const result = assessVideo(frames, snapshots, options, 0);
  expect(codes(result)).toContain('endpoints');
  expect(result.findings.find(f => f.code === 'endpoints')?.action).toContain('erro de perspectiva');
  expect(result.status).toBe('limited');
});
it('aponta movimentos sem confirmação mesmo com algumas repetições contadas', () => {
  const { frames, snapshots } = recording();
  expect(codes(assessVideo(frames, snapshots, options, 1))).toContain('endpoints');
});
it('não confunde repouso e tremores com falta de amplitude', () => {
  const { frames, snapshots } = recording(Array.from({length: 49}, (_, i) => 150 + Math.sin(i) * 3));
  expect(codes(assessVideo(frames, snapshots, options, 0))).toEqual(['no-cycle']);
});
it('prioriza falha de rastreamento e não diagnostica amplitude de leituras perdidas', () => {
  const { frames, snapshots } = recording();
  [...snapshots.values()].forEach((s, i) => { if (i % 4 !== 0) { s.pose = 'no'; s.quality = 'unavailable'; } });
  const result = assessVideo(frames, snapshots, options, 0);
  expect(result.status).toBe('insufficient'); expect(codes(result)).toContain('tracking');
  expect(codes(result)).not.toContain('endpoints');
});
it('separa pose detectada de articulação sem leitura', () => {
  const { frames, snapshots } = recording(); [...snapshots.values()].forEach(s => s.quality = 'estimated');
  expect(codes(assessVideo(frames, snapshots, options, 0))).toContain('angle-reading');
});
it('classifica interrupções frequentes mesmo se houver uma contagem positiva', () => {
  const { frames, snapshots } = recording(); [...snapshots.values()].forEach((s, i) => { if (i % 3 === 0) s.quality = 'unavailable'; });
  const result = assessVideo(frames, snapshots, options, 1);
  expect(codes(result)).toContain('many-failures'); expect(result.status).not.toBe('adequate');
});
it('só atribui enquadramento ruim quando há pontos necessários fora da imagem', () => {
  const { frames, snapshots } = recording(); frames.forEach(f => f.poses[0][16].y = 1.2);
  expect(codes(assessVideo(frames, snapshots, options, 0))).toContain('framing');
  frames.forEach(f => f.poses[0][16] = {...f.poses[0][16], y: 0.5, visibility: 0});
  expect(codes(assessVideo(frames, snapshots, options, 0))).not.toContain('framing');
});
it('não usa o braço não selecionado para reprovar o enquadramento', () => {
  const { frames, snapshots } = recording(); frames.forEach(f => f.poses[0][15].y = 1.2);
  const opts = {...options, jointIndexCandidates: [{side: 'left' as const, jointIndices: [11,13,15] as [number,number,number]}, {side: 'right' as const, jointIndices: options.jointIndices}]};
  expect(codes(assessVideo(frames, snapshots, opts, 2))).not.toContain('framing');
});
it('sinaliza bloqueio pela posição do supino', () => {
  const { frames, snapshots } = recording(); [...snapshots.values()].forEach(s => s.posture.state = 'no');
  expect(codes(assessVideo(frames, snapshots, {...options, requiredPosture: 'incline'}, 0))).toContain('posture');
});
it('julga trajetória do punho sem exigir cotovelo observado', () => {
  const { frames, snapshots } = recording();
  frames.forEach(f => { f.poses[0][12].x = 0.7; f.poses[0][24].x = 0.3; f.poses[0][16].y = 0.2; });
  [...snapshots.values()].forEach(s => s.quality = 'unavailable');
  const result = assessVideo(frames, snapshots, {...options, benchWristTravel: true}, 1);
  expect(result.readableFrames).toBe(frames.length); expect(result.status).toBe('adequate');
  expect(result.note).toContain('não certificam amplitude');
});
it('rejeita trechos vazios, curtos e timestamps duplicados como evidência suficiente', () => {
  expect(codes(assessVideo([], new Map(), options, 0))).toEqual(['too-short']);
  const {frames, snapshots} = recording([170, 60, 170]);
  expect(assessVideo(Array.from({length: 100}, () => frames[0]), snapshots, options, 0).totalFrames).toBe(1);
  expect(codes(assessVideo(frames, snapshots, options, 0))).toContain('too-short');
});
it('não une oscilações separadas por perdas de leitura ou troca de braço', () => {
  const { frames, snapshots } = recording();
  [...snapshots.values()].forEach((s, i) => { s.side = i % 2 ? 'left' : 'right'; });
  expect(codes(assessVideo(frames, snapshots, options, 0))).not.toContain('endpoints');
});
