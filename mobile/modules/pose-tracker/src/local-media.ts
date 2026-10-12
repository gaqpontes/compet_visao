/** Reject network-backed media before any decoder or inference is initialized. */
export function assertLocalVideoUri(uri: string, platform: 'web' | 'native', origin?: string): void {
  let valid = false;
  try {
    const parsed = new URL(uri);
    valid = platform === 'web'
      ? parsed.protocol === 'blob:' && Boolean(origin) && parsed.origin === origin
      : (parsed.protocol === 'file:' && !parsed.hostname) || parsed.protocol === 'content:';
  } catch { /* Invalid and relative URLs are rejected. */ }
  if (!valid) throw new Error('Selecione um vídeo local do dispositivo. URLs remotas não são permitidas.');
}

export const MAX_ANALYSIS_FRAMES = 4800;
export function assertAnalysisBudget(duration: number, fps: number): void {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps < 1 ||
      Math.floor(duration * fps + 1e-6) + 1 > MAX_ANALYSIS_FRAMES) {
    throw new Error('Trecho muito longo ou inválido. Reduza o intervalo ou a taxa de quadros (máximo 4800 amostras).');
  }
}
