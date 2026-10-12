import { assessRepetitions, REPETITION_REFERENCES } from '../src/utils/repetition-feedback';
import type { CounterSnapshot } from '../src/utils/counter-timeline';

const repetition = { index: 1, startTimestampMs: 0, endTimestampMs: 600 };
function timeline(angles = [150, 120, 95, 95, 120, 140, 150, 165, 170, 170, 170, 170]) {
  return new Map(angles.map((angle, i) => [i * 100, {
    angle, quality: 'observed', pose: 'yes', side: 'left', space: 'world', reps: 1,
    progress: 0, posture: { state: 'unknown', label: '' }, flexed: 'unknown', extended: 'unknown', phase: 'EXTENDED',
  } as CounterSnapshot]));
}
const evaluate = (data = timeline(), tolerance = 20) => assessRepetitions(data, [repetition], 'pushup', tolerance)[0];

it('avalia o retorno após a confirmação, sem alterar os intervalos', () => {
  const before = { ...repetition };
  expect(evaluate()).toMatchObject({ status: 'adequate', minAngleDeg: 95, returnAngleDeg: 170, limits: { flexion: 108, extension: 162 } });
  expect(repetition).toEqual(before);
});
it('explica descida e extensão insuficientes para a referência', () => {
  const feedback = evaluate(timeline([150, 130, 120, 120, 130, 140, 150, 150, 150, 150, 150, 150]));
  expect(feedback.status).toBe('inadequate');
  expect(feedback.reasons).toHaveLength(2);
  expect(feedback.reasons.join(' ')).toMatch(/Descida insuficiente.*Retorno sem extensão/);
});
it('aplica a tolerância escolhida à referência sem confundi-la com a contagem', () => {
  expect(evaluate(timeline(), 0).status).toBe('inadequate');
  expect(evaluate(timeline(), 20).status).toBe('adequate');
  expect(() => evaluate(timeline(), 41)).toThrow();
});
it.each(['estimated', 'unavailable'] as const)('não julga execução com leitura %s', quality => {
  const data = timeline();
  data.forEach(s => { s.quality = quality; });
  expect(evaluate(data).status).toBe('unassessable');
});
it.each(['side', 'space'] as const)('não combina mudanças de %s', field => {
  const data = timeline();
  Object.assign(data.get(300)!, { [field]: field === 'side' ? 'right' : 'image' });
  expect(evaluate(data).status).toBe('unassessable');
});
it('não aceita um único ponto extremo como amplitude', () => {
  const feedback = evaluate(timeline([150, 125, 70, 125, 130, 140, 150, 165, 170, 170, 170, 170]));
  expect(feedback.status).toBe('inadequate');
  expect(feedback.minAngleDeg).toBe(125);
});
it('não atribui descida insuficiente quando o ponto profundo ficou oculto', () => {
  const data = timeline([150,125,70,125,130,140,150,165,170,170,170,170]);
  data.get(200)!.quality = 'estimated';
  expect(evaluate(data).status).toBe('unassessable');
});
it('não busca extensão depois de uma nova descida fora dos intervalos detectados', () => {
  const data = timeline([150,120,95,95,120,140,150,150,140,150,170,170]);
  expect(evaluate(data).returnAngleDeg).toBe(150);
  expect(evaluate(data).status).toBe('inadequate');
});
it('não julga trecho com lacuna temporal', () => {
  const data = timeline();
  data.delete(200); data.delete(300); data.delete(400);
  expect(evaluate(data).status).toBe('unassessable');
});
it('não usa o retorno da próxima repetição para aprovar a anterior', () => {
  const data = timeline([150,120,95,95,120,140,150,150,150,150,150,170,170]);
  const result = assessRepetitions(data, [repetition, { index: 2, startTimestampMs: 1000, endTimestampMs: 1200 }], 'pushup');
  expect(result[0].returnAngleDeg).toBe(150);
  expect(result[0].status).toBe('inadequate');
});
it('trata retorno cortado pelo fim do vídeo como não avaliável', () => {
  expect(evaluate(timeline([150,120,95,95,120,140,150,150])).status).toBe('unassessable');
});
it.each(['bench_press_flat', 'bench_press_incline'] as const)('explicita medida ausente no %s', exercise => {
  const result = assessRepetitions(timeline(), [repetition], exercise)[0];
  expect(result.status).toBe('unassessable');
  expect(result.reasons[0]).toMatch(/barra.*peito/);
  expect(result.limits).toBeNull();
});
it('converte flexão anatômica e identifica o protocolo do agachamento', () => {
  expect(REPETITION_REFERENCES.bicep_curl.minAngle).toBe(180 - 130);
  expect(REPETITION_REFERENCES.squat.limitation).toMatch(/acima do paralelo/);
  expect(assessRepetitions(timeline([160,100,65,65,100,140,155,165,170,170,170,170]), [repetition], 'bicep_curl')[0].status).toBe('adequate');
});
