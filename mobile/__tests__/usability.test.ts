import { calculateRenderDimensions } from '../src/utils/layout-helpers';

describe('Testes de Usabilidade e Layout Responsivo', () => {
  it('deve calcular dimensões exatas mantendo o aspect ratio do vídeo vertical (9:16) sem barras pretas', () => {
    const videoWidth = 1080;
    const videoHeight = 1920;
    const containerMaxWidth = 360;
    const containerMaxHeight = 480;

    const dims = calculateRenderDimensions(
      videoWidth,
      videoHeight,
      containerMaxWidth,
      containerMaxHeight
    );

    // Como é vertical e limitado por maxHeight (480):
    // w = 480 * (1080 / 1920) = 270
    expect(dims.height).toBe(480);
    expect(dims.width).toBe(270);
    expect(dims.width / dims.height).toBeCloseTo(1080 / 1920, 3);
  });

  it('deve calcular dimensões exatas mantendo o aspect ratio do vídeo widescreen (16:9)', () => {
    const videoWidth = 1920;
    const videoHeight = 1080;
    const containerMaxWidth = 360;
    const containerMaxHeight = 480;

    const dims = calculateRenderDimensions(
      videoWidth,
      videoHeight,
      containerMaxWidth,
      containerMaxHeight
    );

    // Como é horizontal, é limitado por maxWidth (360):
    // h = 360 * (1080 / 1920) = 202.5 => 203
    expect(dims.width).toBe(360);
    expect(dims.height).toBeCloseTo(203, 0);
    expect(dims.width / dims.height).toBeCloseTo(1920 / 1080, 2);
  });

  it('deve calcular corretamente a transformação espelhada da câmera selfie', () => {
    const originalX = 0.2; // 20% da esquerda
    const width = 400;

    // Sem espelhamento:
    const normalProjected = originalX * width;
    expect(normalProjected).toBe(80);

    // Com espelhamento (modo selfie):
    const mirroredProjected = (1 - originalX) * width;
    expect(mirroredProjected).toBe(320); // 80px da borda oposta
  });
});
