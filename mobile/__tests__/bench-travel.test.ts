import { BenchTravelCounter, getBenchWristElevation } from '../src/utils/bench-travel';
import { getJointCandidateScore, type JointMeasurement } from '../src/utils/pose-measurement';

it.each([6, 8, 15, 30])('conta descida e retorno do punho em %i FPS sem duplicar timestamps', (fps) => {
  const counter = new BenchTravelCounter(); const events: unknown[] = [];
  for (let i = 0; i <= fps * 9; i++) {
    const t = i / fps; const value = 0.6 + 0.4 * Math.cos(2 * Math.PI * t / 3);
    const event = counter.process(t * 1000, value); if (event) events.push(event);
    expect(counter.process(t * 1000, value)).toBeNull();
  }
  expect(events).toHaveLength(3);
});

it('ignora subida inicial, tremores e retorno insuficiente', () => {
  const run = (values: number[]) => {
    const counter = new BenchTravelCounter();
    return values.flatMap((value, i) => counter.process(i * 125, value) ?? []);
  };
  expect(run([0.2,0.3,0.5,0.7,0.9,1,1,1])).toEqual([]);
  expect(run(Array.from({ length: 100 }, (_, i) => 1 + 0.04 * Math.sin(i)))).toEqual([]);
  expect(run([1,1,0.8,0.5,0.2,0.2,0.3,0.4,0.45,0.45])).toEqual([]);
});

it('não une extremos separados por perda longa de leitura', () => {
  const counter = new BenchTravelCounter();
  [1,1,0.8,0.5,0.2,0.2].forEach((v,i) => counter.process(i*125,v));
  counter.process(1500,null);
  [0.3,0.5,0.8,1,1].forEach((v,i) => expect(counter.process(2000+i*125,v)).toBeNull());
  counter.reset();
  expect(counter.process(0,1)).toBeNull();
});

it('penaliza braço métrico desproporcional e estimativas ocultas ao escolher o lado', () => {
  const point = (x: number) => ({ x,y:0,z:0,visibility:1 });
  const measurement: JointMeasurement = { points:[point(0),point(1),point(2)],use3D:true,space:'world',quality:'observed',confidence:0.95 };
  const malformed: JointMeasurement = { ...measurement,points:[point(0),point(1),point(1.1)] };
  expect(getJointCandidateScore(measurement)).toBeGreaterThan(getJointCandidateScore(malformed));
  expect(getJointCandidateScore({ ...measurement,quality:'estimated' })).toBeLessThan(0.3);
  expect(getJointCandidateScore({ ...malformed,use3D:false,space:'image' })).toBeCloseTo(0.95);
});

it('mede elevação sem depender do cotovelo e rejeita punho oculto', () => {
  const pose=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
  pose[11]={...pose[11],x:1}; pose[12]={...pose[12],x:1}; pose[15]={...pose[15],x:1,y:0.5};
  const frame={timestampMs:0,poses:[pose],hands:[],imageSize:{width:100,height:100}};
  expect(getBenchWristElevation(frame,'left')).toBeCloseTo(0.5);
  pose[13].visibility=0; expect(getBenchWristElevation(frame,'left')).toBeCloseTo(0.5);
  pose[15].visibility=0.1; expect(getBenchWristElevation(frame,'left')).toBeNull();
});
