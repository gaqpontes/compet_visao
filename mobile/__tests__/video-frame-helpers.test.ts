import {
  hasFreshPlaybackFrame,
  getInclusiveSampleCount,
  getSampleTime,
  getScaledFrameDimensions,
} from '../modules/pose-tracker/src/video-frame-helpers';

describe('espera por quadros de vídeo novos', () => {
  it('exige atingir o alvo e avançar além do último timestamp capturado', () => {
    expect(hasFreshPlaybackFrame(1, 1, 0.96)).toBe(true);
    expect(hasFreshPlaybackFrame(1, 1, 1)).toBe(false);
    expect(hasFreshPlaybackFrame(0.99, 1, 0.96)).toBe(false);
  });
});

describe('dimensões proporcionais do frame de processamento', () => {
  it('reduz um vídeo 1080p para um terço sem mudar a proporção', () => {
    expect(getScaledFrameDimensions(1920, 1080, 'one-third')).toEqual({
      width: 640,
      height: 360,
    });
  });

  it('calcula a escala de dois terços e a resolução original', () => {
    expect(getScaledFrameDimensions(1920, 1080, 'two-thirds')).toEqual({
      width: 1280,
      height: 720,
    });
    expect(getScaledFrameDimensions(1920, 1080, 'original')).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('mantém dimensões válidas para vídeos menores que um pixel após a escala', () => {
    expect(getScaledFrameDimensions(1, 1, 'one-third')).toEqual({ width: 1, height: 1 });
  });

  it('gera 61 amostras a 12 FPS em um corte inclusivo de cinco segundos', () => {
    const startTime = 2;
    const fps = 12;
    const sampleCount = getInclusiveSampleCount(5, fps);

    expect(sampleCount).toBe(61);
    expect(getSampleTime(startTime, 0, fps)).toBe(2);
    expect(getSampleTime(startTime, sampleCount - 1, fps)).toBeCloseTo(7);
  });

  it.each([6, 8, 12])('mantém os tempos de amostra crescentes a %i FPS', (fps) => {
    const sampleCount = getInclusiveSampleCount(5, fps);
    const sampleTimes = Array.from({ length: sampleCount }, (_, index) =>
      getSampleTime(2, index, fps)
    );

    expect(sampleTimes[0]).toBe(2);
    expect(sampleTimes[sampleTimes.length - 1]).toBeCloseTo(7);
    expect(sampleTimes.every((time, index) => index === 0 || time > sampleTimes[index - 1])).toBe(true);
  });

  it('rejeita escala e parâmetros de amostragem inválidos', () => {
    expect(() => getScaledFrameDimensions(1920, 1080, 'half' as never)).toThrow();
    expect(() => getSampleTime(0, 0, Number.NaN)).toThrow();
    expect(() => getSampleTime(0, 0.5, 12)).toThrow();
  });
});

it('distingue FPS efetivos da configuração solicitada', () => {
  const { getEffectiveSampleRate } = require('../modules/pose-tracker/src/video-frame-helpers');
  expect(getEffectiveSampleRate([{ timestampMs: 0 }, { timestampMs: 125 }, { timestampMs: 250 }])).toBe(8);
  expect(getEffectiveSampleRate([{ timestampMs: 1000 }])).toBeNull();
  expect(getEffectiveSampleRate([{ timestampMs: 0 }, { timestampMs: 0 }])).toBeNull();
});
