import type { FrameResult } from 'pose-tracker';
import type { CounterSnapshot } from './counter-timeline';
import type { RepetitionCounterOptions } from './repetition-counter';
import { getBenchWristElevation } from './bench-travel';

export type VideoFinding = { code: string; title: string; detail: string; action: string };
export type VideoAssessment = {
  status: 'adequate' | 'limited' | 'insufficient'; title: string;
  repetitions: number; trackedFrames: number; readableFrames: number; totalFrames: number;
  findings: VideoFinding[]; note: string;
};

/** Signal-quality heuristics, not exercise technique or a probability of correct counting. */
export function assessVideo(
  frames: FrameResult[], snapshots: Map<number, CounterSnapshot>,
  options: RepetitionCounterOptions, repetitions: number,
): VideoAssessment {
  // Duplicate/invalid timestamps cannot increase the evidence for a verdict.
  let previous = -Infinity;
  const samples = frames.filter(frame => {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= previous) return false;
    previous = frame.timestampMs; return true;
  });
  const findings: VideoFinding[] = [];
  const add = (code: string, title: string, detail: string, action: string) => findings.push({ code, title, detail, action });
  let tracked = 0, readable = 0, cropped = 0, postureBlocked = 0, valleys = 0;
  let lastTime = -Infinity, lastSide: CounterSnapshot['side'] = null;
  let low = Infinity, high = -Infinity, direction = 0;
  const travel = options.benchWristTravel === true;
  const swing = travel ? 0.15 : 20;
  for (const frame of samples) {
    const snapshot = snapshots.get(frame.timestampMs);
    const candidates = snapshot?.side
      ? options.jointIndexCandidates?.filter(candidate => candidate.side === snapshot.side)
      : options.jointIndexCandidates;
    const jointSets = candidates?.length ? candidates.map(candidate => candidate.jointIndices) : [options.jointIndices];
    // Coordinates outside the image support an explicit framing diagnosis; low confidence alone does not.
    if (jointSets.every(indices => indices.some(index => {
      const point = frame.poses[0]?.[index];
      return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
        (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1);
    }))) cropped++;
    if (snapshot?.pose === 'yes') tracked++;
    if (options.requiredPosture && snapshot?.posture.state !== 'yes') postureBlocked++;
    const value = travel
      ? snapshot?.side ? getBenchWristElevation(frame, snapshot.side) : null
      : snapshot?.quality === 'observed' && Number.isFinite(snapshot.angle) ? snapshot.angle : null;
    const usable = snapshot?.pose === 'yes' && value !== null;
    if (!usable) { direction = 0; low = Infinity; high = -Infinity; lastTime = -Infinity; continue; }
    readable++;
    if (frame.timestampMs - lastTime > 500 || snapshot?.side !== lastSide) {
      direction = 0; low = value; high = value;
    }
    low = Math.min(low, value); high = Math.max(high, value);
    if (direction !== -1 && high - value >= swing) { direction = -1; low = value; }
    else if (direction === -1 && value - low >= swing) { valleys++; direction = 1; high = value; }
    lastTime = frame.timestampMs; lastSide = snapshot?.side ?? null;
  }
  const total = samples.length;
  const duration = total ? samples[total - 1].timestampMs - samples[0].timestampMs : 0;
  const trackedRatio = total ? tracked / total : 0;
  const readableRatio = total ? readable / total : 0;
  let status: VideoAssessment['status'] = 'limited';
  if (total < 8 || duration < 2000) {
    add('too-short', 'Trecho insuficiente', 'Há poucos dados para avaliar um ciclo completo.', 'Selecione uma série com pelo menos uma descida e um retorno completos.');
    status = 'insufficient';
  } else {
    if (cropped / total >= 0.3) add('framing', 'Enquadramento inadequado', 'Pontos necessários ao exercício ficaram fora da imagem em parte relevante do trecho.', 'Afaste a câmera e mantenha as articulações do exercício dentro do quadro.');
    if (trackedRatio < 0.5) add('tracking', 'Falha ao rastrear', 'A pose esteve ausente ou foi rejeitada em mais da metade dos quadros.', 'Use câmera fixa, boa iluminação e uma pessoa em destaque, sem obstáculos.');
    else if (trackedRatio < 0.8 || readableRatio < 0.8) add('many-failures', 'Muitas falhas de leitura', 'O rastreamento ou a leitura do movimento teve interrupções frequentes.', 'Confira o esqueleto no replay e escolha um trecho com menos oclusões.');
    if (readableRatio < 0.4 && trackedRatio >= 0.5) add('angle-reading', travel ? 'Trajetória do punho insuficiente' : 'Leitura angular insuficiente', travel ? 'A pose foi encontrada, mas o punho não forneceu uma trajetória utilizável.' : 'A pose foi encontrada, mas as articulações necessárias não forneceram ângulos utilizáveis.', 'Mude o enquadramento para mostrar o lado do corpo e as articulações sem sobreposição.');
    if (options.requiredPosture && postureBlocked / total >= 0.3) add('posture', 'Posição não confirmada', 'A posição compatível com este supino não foi confirmada durante parte relevante do trecho.', 'Confira o exercício selecionado e mostre também o tronco e as pernas.');
    if (readableRatio >= 0.75 && valleys > repetitions) add('endpoints', 'Movimento detectado, amplitude não confirmada', travel ? 'Houve descidas e retornos do punho que não confirmaram os critérios de um ciclo.' : 'Houve variação repetida do ângulo, mas alguns movimentos não confirmaram flexão, extensão ou permanência nos extremos.', 'Reveja os extremos no gráfico. Pode ser amplitude parcial ou erro de perspectiva/rastreamento; o vídeo sozinho não permite distinguir.');
    if (!findings.length && repetitions > 0) status = 'adequate';
    else if (!findings.length) add('no-cycle', 'Nenhuma repetição confirmada', 'A leitura foi estável, mas não confirmou ciclos completos do exercício selecionado.', 'Confira o exercício e inclua o início, a descida e o retorno da série.');
    if (readableRatio < 0.4 || trackedRatio < 0.5) status = 'insufficient';
  }
  return {
    status, title: status === 'adequate' ? 'Adequado para análise' : status === 'insufficient' ? 'Resultado insuficiente' : 'Resultado com ressalvas',
    repetitions, trackedFrames: tracked, readableFrames: readable, totalFrames: total, findings,
    note: travel ? 'Avaliação da leitura do vídeo. Ciclos do punho não certificam amplitude articular nem execução correta.' : 'Avaliação da leitura do vídeo, não da técnica do exercício. Uma leitura estável não garante contagem exata.',
  };
}
