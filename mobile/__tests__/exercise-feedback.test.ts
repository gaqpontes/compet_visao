import { assessBenchPosture, getJointSignals } from '../src/utils/exercise-feedback';
import type { FrameResult } from 'pose-tracker';

function frameAt(angle: number, roll = 0): FrameResult {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const radians = angle * Math.PI / 180;
  const trunk = { x: Math.sin(radians) * 0.3, y: Math.cos(radians) * 0.3 };
  pose[11] = { ...pose[11], x: 0.45 + trunk.x, y: 0.5 + trunk.y };
  pose[12] = { ...pose[12], x: 0.55 + trunk.x, y: 0.5 + trunk.y };
  pose[23].x = 0.45; pose[24].x = 0.55;
  pose[25].y = pose[26].y = 0.6; pose[27].y = pose[28].y = 0.9;
  return { timestampMs: 0, hands: [], poses: [pose.map((p) => ({ ...p,
    x: p.x * Math.cos(roll) - p.y * Math.sin(roll), y: p.x * Math.sin(roll) + p.y * Math.cos(roll),
  }))] };
}

describe('semáforo de posição e articulação', () => {
  it.each([0, Math.PI / 3, Math.PI / 2])('reconhece supino deitado mesmo com câmera rodada %s', (roll) => {
    expect(assessBenchPosture(frameAt(90, roll), 'flat').state).toBe('yes');
    expect(assessBenchPosture(frameAt(140, roll), 'incline').state).toBe('yes');
    expect(assessBenchPosture(frameAt(175, roll), 'flat').state).toBe('no');
    expect(assessBenchPosture(frameAt(175, roll), 'incline').state).toBe('no');
  });

  it('não confirma postura com referências ocultas ou uma pose rejeitada', () => {
    const frame = frameAt(90);
    [25, 26, 27, 28].forEach((i) => { frame.poses[0][i].visibility = 0.1; });
    expect(assessBenchPosture(frame, 'flat').state).toBe('unknown');
    const invalid = { ...frameAt(90), poseAssessment: { status: 'rejected' as const, reason: 'body-flip' as const } };
    expect(assessBenchPosture(invalid, 'flat').state).toBe('unknown');
  });

  it('tolera apoio dos pés oblíquo sem tratar pequenas variações da perna como saída do banco', () => {
    expect(assessBenchPosture(frameAt(50), 'flat').state).toBe('yes');
    expect(assessBenchPosture(frameAt(155), 'flat').state).toBe('no');
  });

  it('diferencia os extremos e mantém estimativas em amarelo', () => {
    expect(getJointSignals(105, 105, 155, 'observed')).toEqual({ flexed: 'yes', extended: 'no' });
    expect(getJointSignals(155, 105, 155, 'observed')).toEqual({ flexed: 'no', extended: 'yes' });
    expect(getJointSignals(125, 105, 155, 'observed')).toEqual({ flexed: 'no', extended: 'no' });
    expect(getJointSignals(155, 105, 155, 'estimated')).toEqual({ flexed: 'unknown', extended: 'unknown' });
  });
});

it('reconhece apoio reclinado com canela oblíqua e não exige o lado oculto', () => {
  const frame=frameAt(90);
  for (const [hip,knee,ankle] of [[23,25,27],[24,26,28]]) {
    frame.poses[0][knee]={...frame.poses[0][knee],x:frame.poses[0][hip].x-0.3,y:0.5};
    frame.poses[0][ankle]={...frame.poses[0][knee],y:0.8};
  }
  [12,24,26,28].forEach((i)=>{frame.poses[0][i].visibility=0.1;});
  expect(assessBenchPosture(frame,'incline').state).toBe('yes');
  frame.poses[0][11].x=frame.poses[0][23].x;
  frame.poses[0][11].y=0.2; // sentado: quadril deixa de estar aberto
  expect(assessBenchPosture(frame,'incline').state).toBe('no');
});
