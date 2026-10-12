/**
 * Calcula dimensões responsivas ideais para renderização de vídeos/câmeras,
 * preservando a proporção de aspecto (aspect ratio) exata para evitar letterboxing e distorções.
 */
export function calculateRenderDimensions(
  mediaWidth: number,
  mediaHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number; aspectRatio: number } {
  if (!mediaWidth || !mediaHeight) {
    return { width: maxWidth, height: maxHeight, aspectRatio: maxWidth / maxHeight };
  }

  const aspectRatio = mediaWidth / mediaHeight;

  let width = maxWidth;
  let height = Math.round(width / aspectRatio);

  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * aspectRatio);
  }

  return { width, height, aspectRatio };
}
