import { getEndpointThresholds } from '../src/utils/endpoint-tolerance';
import { getExerciseCounterOptions, EXERCISES } from '../src/utils/exercises';
import { RepetitionCounter } from '../src/utils/repetition-counter';
import { readCounterSnapshot } from '../src/utils/counter-timeline';

it.each(EXERCISES)('usa 20% da faixa angular em $label', ({id}) => {
  const options = getExerciseCounterOptions(id);
  expect(options.endpointTolerancePercent).toBe(20);
  const limits = getEndpointThresholds(options.minAngleThreshold, options.maxAngleThreshold, options.endpointTolerancePercent);
  const margin = (options.maxAngleThreshold-options.minAngleThreshold)*0.2;
  expect(limits.flexion).toBeCloseTo(options.minAngleThreshold+margin);
  expect(limits.extension).toBeCloseTo(options.maxAngleThreshold-margin);
  expect(limits.flexion).toBeLessThan(limits.extension);
  expect(getEndpointThresholds(options.minAngleThreshold,options.maxAngleThreshold,40).flexionRelease).toBeLessThan(getEndpointThresholds(options.minAngleThreshold,options.maxAngleThreshold,40).extension);
});

it.each([-1, 41, NaN, Infinity])('rejeita margem inválida %s', endpointTolerancePercent => {
  expect(() => new RepetitionCounter({...getExerciseCounterOptions('pushup'), endpointTolerancePercent})).toThrow('tolerância');
});

function run(angles: number[], tolerance: number, unavailable: number[] = []) {
  const options = {jointIndices: [12,14,16] as [number,number,number], minAngleThreshold:80, maxAngleThreshold:155, smoothingAlpha:1, endpointTolerancePercent:tolerance};
  const counter = new RepetitionCounter(options);
  angles.forEach((angle,i) => {
    const pose=Array.from({length:33},()=>({x:0.5,y:0.5,z:0,visibility:1,presence:1}));
    pose[12].x=0.4;
    const rad=(180-angle)*Math.PI/180;
    pose[16]={...pose[16],x:0.5+0.1*Math.cos(rad),y:0.5+0.1*Math.sin(rad)};
    counter.processFrame({timestampMs:i*125, poses: unavailable.includes(i)?[]:[pose],hands:[],poseAssessment:{status:'accepted'}});
  });
  return {counter, options};
}
it('reconhece o ciclo próximo do alvo com 20% e permite torná-lo mais exigente', () => {
  const angles=[160,130,93,93,110,145,145];
  expect(run(angles,20).counter.getRepCount()).toBe(1);
  expect(run(angles,10).counter.getRepCount()).toBe(0);
  expect(run(angles,0).counter.getRepCount()).toBe(0);
});
it.each([
  [160,150,148,150,160,160], // tremor: não chega à flexão
  [160,130,110,110,130,160,160], // flexão além da margem
  [160,130,93,93,110,130,130], // sem retorno à extensão
  [93,93,110,145,145], // começou já flexionado
  [160,130,93,110,145,145], // não permaneceu na flexão
])('não transforma movimento insuficiente em repetição: %j', (...angles) => {
  expect(run(angles,20).counter.getRepCount()).toBe(0);
});
it('não une uma flexão ao retorno após perda prolongada de leitura', () => {
  expect(run([160,130,93,93,93,93,93,110,145,145],20,[4,5,6]).counter.getRepCount()).toBe(0);
});
it('usa a mesma margem no contador e nas faixas de flexão/extensão', () => {
  const {counter,options}=run([160,130,93,93],20);
  expect(readCounterSnapshot(counter,options).flexed).toBe('yes');
  expect(readCounterSnapshot(counter,{...options,endpointTolerancePercent:0}).flexed).toBe('no');
});
