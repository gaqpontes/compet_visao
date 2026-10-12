import { NormalizedLandmark } from 'pose-tracker';

/**
 * Calcula a distância euclidiana entre dois keypoints 2D ou 3D.
 */
export function calculateDistance(
  p1: NormalizedLandmark,
  p2: NormalizedLandmark,
  use3D: boolean = false
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dz = use3D ? (p2.z ?? 0) - (p1.z ?? 0) : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calcula o ângulo articular em graus formado por 3 pontos (A -> B -> C),
 * onde o ponto B é o vértice da articulação (ex: ombro -> cotovelo -> pulso).
 * Os eixos precisam usar a mesma unidade; measureJoint corrige coordenadas de imagem.
 */
export function calculateAngle(
  pointA: NormalizedLandmark,
  pointB: NormalizedLandmark,
  pointC: NormalizedLandmark,
  use3D: boolean = false
): number {
  // Vetores partindo da articulação B
  const vBAx = pointA.x - pointB.x;
  const vBAy = pointA.y - pointB.y;
  const vBAz = use3D ? (pointA.z ?? 0) - (pointB.z ?? 0) : 0;

  const vBCx = pointC.x - pointB.x;
  const vBCy = pointC.y - pointB.y;
  const vBCz = use3D ? (pointC.z ?? 0) - (pointB.z ?? 0) : 0;

  const magBA = Math.sqrt(vBAx * vBAx + vBAy * vBAy + vBAz * vBAz);
  const magBC = Math.sqrt(vBCx * vBCx + vBCy * vBCy + vBCz * vBCz);

  // Tratamento de singularidade (pontos sobrepostos ou vetor nulo)
  if (magBA === 0 || magBC === 0) {
    return 0;
  }

  const dotProduct = vBAx * vBCx + vBAy * vBCy + vBAz * vBCz;
  const cosine = Math.max(-1, Math.min(1, dotProduct / (magBA * magBC)));

  const angleRad = Math.acos(cosine);
  return (angleRad * 180) / Math.PI;
}

/**
 * Filtro de suavização temporal usando Média Móvel Exponencial (EMA).
 * Reduz tremores e ruídos de alta frequência da inferência frame a frame.
 */
export function smoothLandmarks(
  previous: NormalizedLandmark[],
  current: NormalizedLandmark[],
  alpha: number = 0.6
): NormalizedLandmark[] {
  if (!previous || previous.length === 0) {
    return current;
  }

  const weight = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.6;

  return current.map((curr, idx) => {
    const prev = previous[idx];
    if (!prev) return curr;

    return {
      x: weight * curr.x + (1 - weight) * prev.x,
      y: weight * curr.y + (1 - weight) * prev.y,
      z: weight * (curr.z ?? 0) + (1 - weight) * (prev.z ?? 0),
      visibility: curr.visibility,
      presence: curr.presence,
    };
  });
}

/** Preserve the EMA time constant when the sampling interval changes (reference: 15 FPS). */
export function getTemporalSmoothingAlpha(alpha: number, elapsedMs: number): number {
  const weight = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.45;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return weight;
  return 1 - Math.pow(1 - weight, elapsedMs / (1000 / 15));
}
