import type { CounterSnapshot } from './counter-timeline';
import type { CompletedRepetition } from './repetition-counter';
import type { ExerciseType } from './exercises';
import { DEFAULT_ENDPOINT_TOLERANCE_PERCENT, getEndpointThresholds } from './endpoint-tolerance';

export type RepetitionFeedback = {
  index: number;
  status: 'adequate' | 'inadequate' | 'unassessable';
  label: string;
  reasons: string[];
  minAngleDeg: number | null;
  returnAngleDeg: number | null;
  observedFraction: number;
  referenceId: string;
  tolerancePercent: number;
  limits: { flexion: number; extension: number } | null;
};

// Study protocols, not universal clinical/safety thresholds. Interior three-point
// angle = 180 - anatomical flexion. Percentage and quality gates are app heuristics.
export const REPETITION_REFERENCES = {
  pushup: {
    id: 'franca-2023', author: 'França et al., 2023', doi: '10.5114/hm.2023.117778',
    url: 'https://hummov.awf.wroc.pl/pdf-151850-103886?filename=Associations-between-musc.pdf',
    minAngle: 90, maxAngle: 180,
    description: 'Flexão: cotovelo próximo de 90° na descida e extensão no retorno.',
    limitation: 'Protocolo em futebolistas adolescentes. Alinhamento do corpo e controle do movimento não são certificados aqui.',
  },
  bicep_curl: {
    id: 'kleiber-2015', author: 'Kleiber et al., 2015', doi: '10.3389/fphys.2015.00215',
    url: 'https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2015.00215/full',
    minAngle: 50, maxAngle: 180,
    description: 'Rosca: referência de 0–130° de flexão anatômica, equivalente a 180–50° no gráfico.',
    limitation: 'Protocolo de flexão do cotovelo em laboratório; não estabelece uma amplitude universal para toda variante de rosca.',
  },
  squat: {
    id: 'cotter-2013', author: 'Cotter et al., 2013', doi: '10.1519/JSC.0b013e3182773319',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4064719/',
    minAngle: 90, maxAngle: 180,
    description: 'Agachamento: referência de descida a 90° de flexão do joelho e retorno estendido.',
    limitation: '90° corresponde ao protocolo acima do paralelo. Há outras profundidades válidas; este critério não exige agachamento profundo nem avalia alinhamento ou carga.',
  },
  bench_press_flat: {
    id: 'rodriguez-ridao-2020', author: 'Rodríguez-Ridao et al., 2020', doi: '10.3390/ijerph17197339',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7579505/',
    minAngle: null, maxAngle: null,
    description: 'Supino: protocolo com barra próxima ao peito e retorno com cotovelos estendidos.',
    limitation: 'Sem rastrear a barra e a distância ao peito, o app não confirma esse protocolo. O estudo não fornece um ângulo fixo de cotovelo na descida.',
  },
  bench_press_incline: {
    id: 'rodriguez-ridao-2020', author: 'Rodríguez-Ridao et al., 2020', doi: '10.3390/ijerph17197339',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7579505/',
    minAngle: null, maxAngle: null,
    description: 'Supino inclinado: protocolo com barra próxima ao peito e retorno com cotovelos estendidos.',
    limitation: 'Sem rastrear a barra e a distância ao peito, o app não confirma esse protocolo. A inclinação do banco não é o ângulo do cotovelo.',
  },
} as const;

type Sample = { time: number; value: CounterSnapshot };
const usable = (s: CounterSnapshot) => s.pose === 'yes' && s.quality === 'observed'
  && s.space !== null && s.side !== null && Number.isFinite(s.angle) && s.angle >= 0 && s.angle <= 180;

// Endpoint supported by adjacent observed samples spanning >=100ms.
// A single outlier, estimated frame or gap cannot confirm an endpoint.
function sustainedExtreme(samples: Sample[], kind: 'min' | 'max'): number | null {
  let extreme: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    if (!usable(samples[i].value)) continue;
    const values: number[] = [];
    for (let j = i; j < samples.length; j++) {
      const sample = samples[j];
      if (!usable(sample.value) || (j > i && sample.time - samples[j - 1].time > 250)) break;
      values.push(sample.value.angle);
      if (sample.time - samples[i].time >= 100) {
        const candidate = kind === 'min' ? Math.max(...values) : Math.min(...values);
        extreme = extreme === null ? candidate : kind === 'min' ? Math.min(extreme, candidate) : Math.max(extreme, candidate);
        break;
      }
    }
  }
  return extreme;
}

export function assessRepetitions(
  snapshots: Map<number, CounterSnapshot>, repetitions: CompletedRepetition[],
  exercise: ExerciseType, tolerancePercent = DEFAULT_ENDPOINT_TOLERANCE_PERCENT,
): RepetitionFeedback[] {
  getEndpointThresholds(0, 180, tolerancePercent);
  const reference = REPETITION_REFERENCES[exercise];
  const limits = reference.minAngle === null ? null
    : getEndpointThresholds(reference.minAngle, reference.maxAngle, tolerancePercent);
  const samples = [...snapshots].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time);
  return repetitions.map((rep, i) => {
    const core = samples.filter(s => s.time >= rep.startTimestampMs && s.time <= rep.endTimestampMs);
    // Confirmation precedes the final extension plateau. Look forward within
    // this return only, stopping before the next repetition or a new descent.
    const until = Math.min(rep.endTimestampMs + 1000, repetitions[i + 1]?.startTimestampMs ?? Infinity);
    const tail: Sample[] = [];
    for (const s of samples) {
      if (s.time < rep.endTimestampMs || s.time >= until) continue;
      const angles = tail.filter(t => usable(t.value)).map(t => t.value.angle);
      const peak = angles.length ? Math.max(...angles) : -Infinity;
      if (usable(s.value) && s.value.angle < peak - 5) break;
      tail.push(s);
    }
    const scope = [...core, ...tail.filter(s => s.time > rep.endTimestampMs)];
    const observed = scope.filter(s => usable(s.value));
    const fraction = scope.length ? observed.length / scope.length : 0;
    const identity = new Set(observed.map(s => s.value.side + ':' + s.value.space));
    const min = sustainedExtreme(core, 'min'), max = sustainedExtreme(tail, 'max');
    const base = { index: rep.index, minAngleDeg: min, returnAngleDeg: max, observedFraction: fraction,
      referenceId: reference.id, tolerancePercent,
      limits: limits ? { flexion: limits.flexion, extension: limits.extension } : null };
    const unknown = (reason: string): RepetitionFeedback => ({ ...base, status: 'unassessable', label: 'Não avaliável', reasons: [reason] });
    if (!limits) return unknown(reference.limitation);
    if (fraction < 0.8 || identity.size !== 1 || observed.length < 4 ||
        scope.some((s, j) => j > 0 && s.time - scope[j - 1].time > 250)) {
      return unknown('Leitura insuficiente: oclusão, intervalo sem dados ou mudança de lado/espaço de medição. Não é possível atribuir uma falha à execução.');
    }
    if (min === null || max === null) return unknown('Extremos sem observações consecutivas suficientes; não é possível confirmar a amplitude.');
    if ((min > limits.flexion && core.some(s => !usable(s.value))) ||
        (max < limits.extension && tail.some(s => !usable(s.value)))) {
      return unknown('Houve perda de leitura no movimento sem confirmação do extremo exigido. A amplitude não pode ser julgada neste trecho.');
    }
    const reasons: string[] = [];
    if (min > limits.flexion) reasons.push(`Descida insuficiente para esta referência: ${min}°; esperado até ${limits.flexion.toFixed(1)}° com a tolerância escolhida.`);
    if (max < limits.extension) {
      if ((samples[samples.length - 1]?.time ?? rep.endTimestampMs) - rep.endTimestampMs < 500 &&
          until > (samples[samples.length - 1]?.time ?? 0)) {
        return unknown('O vídeo termina antes de confirmar o retorno estendido desta repetição.');
      }
      reasons.push(`Retorno sem extensão suficiente para esta referência: ${max}°; esperado a partir de ${limits.extension.toFixed(1)}° com a tolerância escolhida.`);
    }
    return { ...base, status: reasons.length ? 'inadequate' : 'adequate',
      label: reasons.length ? 'Inadequada para a referência angular' : 'Adequada para a referência angular',
      reasons: reasons.length ? reasons : [`Descida a ${min}° e retorno a ${max}° atendem aos dois limites com ${tolerancePercent}% de tolerância.`] };
  });
}
