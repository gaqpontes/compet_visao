/** @jest-environment node */
import tracker from '../modules/pose-tracker/src/PoseTrackerModule.web';

describe('pipeline Web com inferência simulada', () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replaceGlobal = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };

  afterEach(() => {
    originals.forEach((descriptor, name) => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
    originals.clear();
  });

  it.each([{ hideTab: false, slowGPU: false }, { hideTab: true, slowGPU: false }, { hideTab: false, slowGPU: true }])('preserva amostragem, segundo plano e recuperação: %j', async ({ hideTab, slowGPU }) => {
    const video = {
      currentTime: 0, readyState: 2, videoWidth: 1920, videoHeight: 1080,
      duration: 10, seeking: false, ended: false, playing: false, style: {}, parentNode: null,
      addEventListener() {}, removeEventListener() {},
      async play() { this.playing = true; }, pause() { this.playing = false; },
    };
    const point = { x: 0.5, y: 0.5, z: 0, visibility: 0.1, presence: 0.95 };
    const worldPoint = { x: 0.2, y: 0.1, z: -0.3 };
    const close = jest.fn();
    const timestamps: number[] = [];
    let simulatedClock = 0;
    if (slowGPU) replaceGlobal('performance', { now: () => simulatedClock++ });
    const create = jest.fn(async (_vision: unknown, options: { baseOptions: { delegate: string } }) => ({
      detectForVideo(_canvas: unknown, timestamp: number) {
        if (slowGPU && options.baseOptions.delegate === 'GPU') simulatedClock += 3000;
        timestamps.push(timestamp);
        expect(video.playing).toBe(false);
        if (video.playing) video.currentTime += 0.3;
        return { landmarks: [[point]], worldLandmarks: [[worldPoint]] };
      }, close,
    }));
    replaceGlobal('window', { location: { origin: 'http://localhost' }, Vision: { FilesetResolver: { forVisionTasks: async () => ({}) }, PoseLandmarker: { createFromOptions: create } } });
    const visibilityListeners = new Set<() => void>();
    const fakeDocument = {
      visibilityState: 'visible',
      addEventListener(name: string, listener: () => void) { if (name === 'visibilitychange') visibilityListeners.add(listener); },
      removeEventListener(name: string, listener: () => void) { if (name === 'visibilitychange') visibilityListeners.delete(listener); },
      body: { appendChild() {}, removeChild() {} },
      createElement: (type: string) => type === 'video' ? video : { getContext: () => ({ drawImage() {}, save() {}, restore() {}, translate() {}, rotate() {} }) },
    };
    replaceGlobal('document', fakeDocument);
    replaceGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(() => {
      if (video.playing) video.currentTime += fakeDocument.visibilityState === 'hidden' ? 1 : 0.125;
      callback();
    }, 0));
    replaceGlobal('cancelAnimationFrame', clearTimeout);

    let resume: Promise<void> = Promise.resolve();
    const frames = await tracker.analyzeVideo('blob:http://localhost/test-video', { startTime: 0, endTime: 1,
      onProgress: (progress) => {
        if (!hideTab || progress.currentFrame !== 1) return;
        fakeDocument.visibilityState = 'hidden';
        visibilityListeners.forEach((listener) => listener());
        resume = new Promise((resolve) => setTimeout(() => {
          fakeDocument.visibilityState = 'visible';
          visibilityListeners.forEach((listener) => listener());
          resolve();
        }, 10));
      },
    });
    await resume;
    expect(frames.map((frame) => frame.timestampMs)).toEqual([0, 125, 250, 375, 500, 625, 750, 875, 1000]);
    expect(frames.every((frame) => frame.timestampMs <= 1000)).toBe(true);
    expect(frames[0].poses[0][0].presence).toBe(0.95);
    expect(frames[0].worldPoses).toEqual([[worldPoint]]);
    expect(frames[0].imageSize).toEqual({ width: 640, height: 360 });
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      runningMode: 'VIDEO', minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.5,
      baseOptions: expect.objectContaining({ modelAssetPath: expect.stringContaining('pose_landmarker_full') }),
    }));
    expect(close).toHaveBeenCalledTimes(slowGPU ? 2 : 1);
    if (slowGPU) expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ baseOptions: expect.objectContaining({ delegate: 'CPU' }) }));
    expect(video.playing).toBe(false);
    video.currentTime = 0;
    const repeated = await tracker.analyzeVideo('blob:http://localhost/second-video', { endTime: 0.25 });
    expect(repeated.map((frame) => frame.timestampMs)).toEqual([0, 125, 250]);
    expect(timestamps).toEqual([...frames.map((f) => f.timestampMs), 0, 125, 250]);
    expect(create).toHaveBeenCalledTimes(slowGPU ? 4 : 2);
    expect(close).toHaveBeenCalledTimes(slowGPU ? 4 : 2);

  });
});
