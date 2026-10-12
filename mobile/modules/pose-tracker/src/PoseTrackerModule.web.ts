import { assertLocalVideoUri, assertAnalysisBudget } from './local-media';
import { getLandmarkConfidence } from './landmark-confidence';
import { FrameResult, VideoAnalysisOptions, NormalizedLandmark, HandLandmarkResult, PoseModel } from './PoseTracker.types';
import { PoseContinuityFilter } from './pose-continuity';
import { DEFAULT_VIDEO_ANALYSIS_OPTIONS } from './video-analysis-defaults';
import {
  getInclusiveSampleCount,
  getSampleTime,
  getScaledFrameDimensions,
  hasFreshPlaybackFrame,
  PLAYBACK_TIME_EPSILON_SECONDS,
} from './video-frame-helpers';

let visionSdkPromise: Promise<any> | null = null;
const MEDIAPIPE_LOCAL = '/mediapipe';
const VISION_SDK_INTEGRITY = 'sha256-Aiy7/Nt0uuGOS7xyLkKeBG1f3TX2GD8TWcVrZSuLh/c=';

const POSE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30],
  [30, 32], [28, 32],
];

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10],
  [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18],
  [18, 19], [19, 20], [5, 9], [9, 13], [13, 17],
];

function isDrawableLandmark(point: NormalizedLandmark | undefined) {
  return Boolean(
    point &&
      getLandmarkConfidence(point) !== null &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  );
}

function drawConnections(
  context: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  connections: [number, number][],
  width: number,
  height: number
) {
  context.beginPath();
  for (const [start, end] of connections) {
    const from = landmarks[start];
    const to = landmarks[end];
    if (!isDrawableLandmark(from) || !isDrawableLandmark(to)) continue;
    if ((from.visibility ?? 1) < 0.3 || (to.visibility ?? 1) < 0.3) continue;
    context.moveTo(from.x * width, from.y * height);
    context.lineTo(to.x * width, to.y * height);
  }
  context.stroke();
  // Paint inferred segments separately so the preview exposes uncertainty.
  const strokeStyle = context.strokeStyle;
  context.strokeStyle = '#FBBF24';
  context.setLineDash([5, 4]);
  context.beginPath();
  for (const [start, end] of connections) {
    const from = landmarks[start];
    const to = landmarks[end];
    if (!isDrawableLandmark(from) || !isDrawableLandmark(to)) continue;
    if ((from.visibility ?? 1) >= 0.3 && (to.visibility ?? 1) >= 0.3) continue;
    context.moveTo(from.x * width, from.y * height);
    context.lineTo(to.x * width, to.y * height);
  }
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = strokeStyle;
}

function drawPoints(
  context: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  radius: number
) {
  for (const point of landmarks) {
    if (!isDrawableLandmark(point)) continue;
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawAnalysisOverlay(
  context: CanvasRenderingContext2D,
  poses: NormalizedLandmark[][],
  hands: HandLandmarkResult[],
  width: number,
  height: number
) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#00E5FF';
  context.lineWidth = 3;
  for (const landmarks of poses) drawConnections(context, landmarks, POSE_CONNECTIONS, width, height);
  context.fillStyle = '#FF0055';
  for (const landmarks of poses) drawPoints(context, landmarks, width, height, 4);

  context.strokeStyle = '#00FF66';
  context.lineWidth = 2;
  for (const hand of hands) drawConnections(context, hand.landmarks, HAND_CONNECTIONS, width, height);
  context.fillStyle = '#FFDD00';
  for (const hand of hands) drawPoints(context, hand.landmarks, width, height, 3);
  context.restore();
}

type DiagnosticReporter = (stage: string, details?: string) => void;

async function waitUntilPageVisible(report: DiagnosticReporter): Promise<void> {
  if (document.visibilityState !== 'hidden') return;
  report('BACKGROUND_PAUSED', 'analysis waits for the tab to become visible');
  await new Promise<void>((resolve) => {
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', resume);
      report('BACKGROUND_RESUMED');
      resolve();
    };
    document.addEventListener('visibilitychange', resume);
  });
}

async function createPoseLandmarker(
  Vision: any,
  vision: any,
  runningMode: 'VIDEO' | 'IMAGE',
  report: DiagnosticReporter = () => {},
  model: PoseModel = 'lite',
  preferredDelegate: 'GPU' | 'CPU' = 'GPU'
) {
  const create = (delegate: 'GPU' | 'CPU') =>
    Vision.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          `${MEDIAPIPE_LOCAL}/models/pose_landmarker_${model}.task`,
        delegate,
      },
      runningMode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.4,
    });
  if (preferredDelegate === 'CPU') {
    report('POSE_MODEL_CPU_START');
    const landmarker = await create('CPU');
    report('POSE_MODEL_CPU_READY');
    return landmarker;
  }
  report('POSE_MODEL_GPU_START');
  try {
    const landmarker = await create('GPU');
    report('POSE_MODEL_GPU_READY');
    return landmarker;
  } catch (error) {
    report('POSE_MODEL_GPU_FAILED', error instanceof Error ? error.message : String(error));
    report('POSE_MODEL_CPU_START');
    const landmarker = await create('CPU');
    report('POSE_MODEL_CPU_READY');
    return landmarker;
  }
}

async function createHandLandmarker(
  Vision: any,
  vision: any,
  runningMode: 'VIDEO' | 'IMAGE',
  report: DiagnosticReporter = () => {}
) {
  const create = (delegate: 'GPU' | 'CPU') =>
    Vision.HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          `${MEDIAPIPE_LOCAL}/models/hand_landmarker.task`,
        delegate,
      },
      runningMode,
      numHands: 2,
    });
  report('HAND_MODEL_GPU_START');
  try {
    const landmarker = await create('GPU');
    report('HAND_MODEL_GPU_READY');
    return landmarker;
  } catch (error) {
    report('HAND_MODEL_GPU_FAILED', error instanceof Error ? error.message : String(error));
    report('HAND_MODEL_CPU_START');
    const landmarker = await create('CPU');
    report('HAND_MODEL_CPU_READY');
    return landmarker;
  }
}

function loadVisionSdk(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('MediaPipe Web só pode ser executado no navegador'));
  }
  if ((window as any).Vision) {
    return Promise.resolve((window as any).Vision);
  }
  if (!visionSdkPromise) {
    visionSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${MEDIAPIPE_LOCAL}/vision_bundle.js`;
      script.crossOrigin = 'anonymous';
      script.integrity = VISION_SDK_INTEGRITY;
      script.onload = () => {
        if ((window as any).Vision) {
          resolve((window as any).Vision);
        } else {
          visionSdkPromise = null;
          reject(new Error('Vision SDK não foi inicializado no window'));
        }
      };
      script.onerror = (e) => {
        visionSdkPromise = null;
        reject(new Error('Falha ao carregar MediaPipe Vision SDK: ' + e));
      };
      document.head.appendChild(script);
    });
  }
  return visionSdkPromise;
}

// Instâncias dedicadas para a câmera ao vivo (para não colidir com analyzeVideo)
let livePoseLandmarker: any = null;
let liveHandLandmarker: any = null;
let liveLandmarkersPromise: Promise<{ poseLandmarker: any; handLandmarker: any }> | null = null;

export async function getLiveWebLandmarkers() {
  if (livePoseLandmarker && liveHandLandmarker) {
    return { poseLandmarker: livePoseLandmarker, handLandmarker: liveHandLandmarker };
  }
  if (!liveLandmarkersPromise) {
    liveLandmarkersPromise = (async () => {
      const Vision = await loadVisionSdk();
      const vision = await Vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_LOCAL}/wasm`);
      try {
        livePoseLandmarker = await createPoseLandmarker(Vision, vision, 'VIDEO');
        liveHandLandmarker = await createHandLandmarker(Vision, vision, 'VIDEO');
        return { poseLandmarker: livePoseLandmarker, handLandmarker: liveHandLandmarker };
      } catch (error) {
        livePoseLandmarker?.close();
        liveHandLandmarker?.close();
        livePoseLandmarker = null;
        liveHandLandmarker = null;
        throw error;
      }
    })();
  }

  try {
    return await liveLandmarkersPromise;
  } catch (error) {
    liveLandmarkersPromise = null;
    throw error;
  }
}

export default {
  async analyzeVideo(uri: string, options?: VideoAnalysisOptions): Promise<FrameResult[]> {
    assertLocalVideoUri(uri, 'web', typeof window === 'undefined' ? undefined : window.location.origin);
    const analysisStartedAt = performance.now();
    const report: DiagnosticReporter = (stage, details = '') => {
      options?.onDiagnostic?.(
        `[${new Date().toISOString()}] +${(performance.now() - analysisStartedAt).toFixed(1)}ms ${stage}${details ? ` ${JSON.stringify(details)}` : ''}`
      );
    };
    const fps = options?.fps ?? DEFAULT_VIDEO_ANALYSIS_OPTIONS.fps;
    const detectHands = options?.detectHands ?? DEFAULT_VIDEO_ANALYSIS_OPTIONS.detectHands;
    const scale = options?.scale ?? DEFAULT_VIDEO_ANALYSIS_OPTIONS.scale;
    report('PIPELINE_START', `fps=${fps} scale=${scale} hands=${detectHands}`);
    if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
      throw new Error('A taxa de quadros deve ser um inteiro entre 1 e 60 FPS.');
    }
    const poseModel = options?.poseModel ?? DEFAULT_VIDEO_ANALYSIS_OPTIONS.poseModel;
    if (!['lite', 'full', 'heavy'].includes(poseModel)) throw new Error('Modelo de pose inválido.');
    const results: FrameResult[] = [];
    const poseFilter = new PoseContinuityFilter();
    await waitUntilPageVisible(report);

    const sdkStartedAt = performance.now();
    report('SDK_LOAD_START');
    const Vision = await loadVisionSdk();
    const sdkMs = performance.now() - sdkStartedAt;
    report('SDK_LOAD_END', `durationMs=${sdkMs.toFixed(1)}`);
    const wasmStartedAt = performance.now();
    report('WASM_RESOLVER_START');
    const vision = await Vision.FilesetResolver.forVisionTasks(
      `${MEDIAPIPE_LOCAL}/wasm`
    );
    const wasmMs = performance.now() - wasmStartedAt;
    report('WASM_RESOLVER_END', `durationMs=${wasmMs.toFixed(1)}`);

    // Each file owns a VIDEO graph and its increasing media timestamps. Never share with the camera.
    const poseModelStartedAt = performance.now();
    report('POSE_MODEL_INIT_START');
    report('POSE_MODEL_CONFIG', `model=${poseModel} mode=VIDEO`);
    let usingCPU = false;
    const poseReporter: DiagnosticReporter = (stage, details) => {
      if (stage === 'POSE_MODEL_CPU_READY') usingCPU = true;
      report(stage, details);
    };
    let poseLandmarker = await createPoseLandmarker(Vision, vision, 'VIDEO', poseReporter, poseModel);
    let slowPoseStreak = 0;
    let slowGPUFallbackAttempted = false;
    const poseModelMs = performance.now() - poseModelStartedAt;
    report('POSE_MODEL_INIT_END', `durationMs=${poseModelMs.toFixed(1)}`);
    let handLandmarker: any = null;
    let handModelMs = 0;
    try {
      if (detectHands) {
        const handModelStartedAt = performance.now();
        report('HAND_MODEL_INIT_START');
        handLandmarker = await createHandLandmarker(Vision, vision, 'VIDEO', report);
        handModelMs = performance.now() - handModelStartedAt;
        report('HAND_MODEL_INIT_END', `durationMs=${handModelMs.toFixed(1)}`);
      } else {
        report('HAND_MODEL_SKIPPED', 'disabled by configuration');
      }
    } catch (error) {
      poseLandmarker.close();
      throw error;
    }

    // Elemento de vídeo anexado ao DOM para evitar que o navegador congele o decodificador
    const video = document.createElement('video');
    video.src = uri;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    // Slow media advancement at high requested FPS; inference itself runs while paused.
    video.playbackRate = Math.min(1, 8 / fps);
    video.style.position = 'fixed';
    video.style.top = '-9999px';
    video.style.left = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    let videoMetadataMs = 0;
    try {
      const metadataStartedAt = performance.now();
      report('VIDEO_METADATA_START');
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 1) {
          resolve();
          return;
        }
        const timeout = setTimeout(() => {
          if (video.readyState >= 1) resolve();
          else reject(new Error('Timeout ao carregar metadados do vídeo'));
        }, 10000);

        video.onloadedmetadata = () => {
          clearTimeout(timeout);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Erro ao carregar o vídeo'));
        };
      });
      videoMetadataMs = performance.now() - metadataStartedAt;
      report(
        'VIDEO_METADATA_END',
        `durationMs=${videoMetadataMs.toFixed(1)} width=${video.videoWidth} height=${video.videoHeight} durationSec=${video.duration.toFixed(3)} readyState=${video.readyState}`
      );

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Duração do vídeo inválida.');
      const startTime = options?.startTime ?? 0;
      const requestedEndTime = options?.endTime;
      if (!Number.isFinite(startTime) || startTime < 0) {
        throw new Error('O início do intervalo é inválido.');
      }
      if (requestedEndTime !== undefined && !Number.isFinite(requestedEndTime)) {
        throw new Error('O fim do intervalo é inválido.');
      }
      const endTime = requestedEndTime === undefined ? duration : Math.min(duration, requestedEndTime);
      if (endTime <= startTime) {
        throw new Error('O fim do intervalo precisa ser posterior ao início.');
      }
      const processDuration = Math.max(0, endTime - startTime);
      assertAnalysisBudget(processDuration, fps);
      const totalFrames = getInclusiveSampleCount(processDuration, fps);

      const canvasStartedAt = performance.now();
      const targetDimensions = getScaledFrameDimensions(
        video.videoWidth,
        video.videoHeight,
        scale
      );
      const { width: targetWidth, height: targetHeight } = targetDimensions;

      // Canvas intermediário com resolução configurável para inferência ultrarrápida do MediaPipe
      const processCanvas = document.createElement('canvas');
      processCanvas.width = targetWidth;
      processCanvas.height = targetHeight;
      const processCtx = processCanvas.getContext('2d');
      if (!processCtx) throw new Error('Não foi possível criar o canvas de processamento.');
      const previewCanvas = options?.previewCanvas as HTMLCanvasElement | undefined;
      const previewCtx = previewCanvas?.getContext('2d') ?? null;
      const previewFrameCanvas = previewCanvas ? document.createElement('canvas') : null;
      if (previewFrameCanvas && previewCanvas) {
        previewFrameCanvas.width = previewCanvas.width;
        previewFrameCanvas.height = previewCanvas.height;
      }
      const previewFrameCtx = previewFrameCanvas?.getContext('2d') ?? null;
      const canvasMs = performance.now() - canvasStartedAt;
      report('CANVAS_READY', `durationMs=${canvasMs.toFixed(1)} source=${video.videoWidth}x${video.videoHeight} input=${targetWidth}x${targetHeight}`);
      const setup = {
        sdkMs,
        wasmMs,
        poseModelMs,
        handModelMs,
        videoMetadataMs,
        canvasMs,
        totalMs: performance.now() - analysisStartedAt,
      };

      // Aguarda o quadro decodificado pelo estado/eventos do vídeo, sem depender de
      // requestVideoFrameCallback: no Firefox ele pode não disparar para este vídeo oculto.
      const seekTo = (targetTime: number): Promise<string> => {
        return new Promise<string>((resolve, reject) => {
          let settled = false;
          let animationFrameId: number | null = null;
          let timeoutId: ReturnType<typeof setTimeout>;
          const isTargetReady = () =>
            Math.abs(video.currentTime - targetTime) < 0.005 &&
            video.readyState >= 2 &&
            !video.seeking;
          const finish = (reason: string, error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('loadeddata', onReadyEvent);
            video.removeEventListener('canplay', onReadyEvent);
            video.removeEventListener('timeupdate', onReadyEvent);
            if (error) reject(error);
            else resolve(reason);
          };
          const checkReady = (reason: string) => {
            if (isTargetReady()) finish(reason);
          };
          const onSeeked = () => checkReady('seeked');
          const onReadyEvent = () => checkReady('video-ready-event');
          const pollReadiness = () => {
            if (settled) return;
            if (isTargetReady()) {
              finish('ready-state-poll');
              return;
            }
            animationFrameId = requestAnimationFrame(pollReadiness);
          };

          timeoutId = setTimeout(() => {
            finish(
              'timeout',
              new Error(
                `Timeout ao buscar ${targetTime.toFixed(3)}s (current=${video.currentTime.toFixed(3)}s, readyState=${video.readyState}, seeking=${video.seeking}).`
              )
            );
          }, 5000);
          video.addEventListener('seeked', onSeeked);
          video.addEventListener('loadeddata', onReadyEvent);
          video.addEventListener('canplay', onReadyEvent);
          video.addEventListener('timeupdate', onReadyEvent);

          try {
            if (Math.abs(video.currentTime - targetTime) >= 0.005) {
              video.currentTime = targetTime;
            } else {
              checkReady('already-at-target');
            }
          } catch (error) {
            finish('seek-error', error instanceof Error ? error : new Error(String(error)));
            return;
          }
          if (!settled) animationFrameId = requestAnimationFrame(pollReadiness);
        });
      };

      const captureVideoFrame = () => {
        const drawStartedAt = performance.now();
        processCtx.drawImage(video, 0, 0, targetWidth, targetHeight);
        const drawMs = performance.now() - drawStartedAt;
        let previewSnapshotMs = 0;
        if (previewFrameCanvas && previewFrameCtx) {
          const previewSnapshotStartedAt = performance.now();
          previewFrameCtx.drawImage(video, 0, 0, previewFrameCanvas.width, previewFrameCanvas.height);
          previewSnapshotMs = performance.now() - previewSnapshotStartedAt;
        }
        return { drawMs, previewSnapshotMs };
      };

      const waitForPlaybackFrame = (
        targetTime: number,
        previousMediaTime: number
      ): Promise<{ mediaTime: number; frameWaitMs: number; drawMs: number; previewSnapshotMs: number }> => {
        const waitStartedAt = performance.now();
        return new Promise((resolve, reject) => {
          let settled = false;
          let animationFrameId: number | null = null;
          let timeoutId: ReturnType<typeof setTimeout>;
          const armTimeout = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              if (document.visibilityState === 'hidden') { armTimeout(); return; }
              finish(new Error(
              `Timeout aguardando quadro em reprodução (target=${targetTime.toFixed(3)}s, current=${video.currentTime.toFixed(3)}s, readyState=${video.readyState}, ended=${video.ended}).`
              ));
            }, 5000);
          };

          const finish = (error?: Error, frame?: { mediaTime: number; drawMs: number; previewSnapshotMs: number }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (error) reject(error);
            else if (frame) {
              resolve({ ...frame, frameWaitMs: performance.now() - waitStartedAt });
            }
          };

          const checkForFrame = () => {
            animationFrameId = null;
            if (settled) return;
            if (document.visibilityState === 'hidden') return;
            if (
              video.readyState >= 2 &&
              !video.seeking &&
              hasFreshPlaybackFrame(video.currentTime, targetTime, previousMediaTime)
            ) {
              video.pause();
              const mediaTime = video.currentTime;
              finish(undefined, { mediaTime, ...captureVideoFrame() });
              return;
            }
            if (video.ended) {
              finish(new Error(`O vídeo terminou antes do quadro solicitado em ${targetTime.toFixed(3)}s.`));
              return;
            }
            animationFrameId = requestAnimationFrame(checkForFrame);
          };
          const startPlayback = () => {
            if (settled || document.visibilityState === 'hidden') return;
            report('VIDEO_PLAY_START', `fromSec=${video.currentTime.toFixed(3)}`);
            const startedAt = performance.now();
            void video.play().then(() => {
              report('VIDEO_PLAYING', `durationMs=${(performance.now() - startedAt).toFixed(1)} currentSec=${video.currentTime.toFixed(3)}`);
            }).catch((error) => {
              if (document.visibilityState !== 'hidden' && error?.name !== 'AbortError') finish(error);
            });
          };
          const onVisibilityChange = () => {
            if (settled) return;
            if (document.visibilityState === 'hidden') {
              video.pause();
              report('BACKGROUND_PAUSED', 'video paused to preserve sample spacing');
            } else {
              report('BACKGROUND_RESUMED');
              armTimeout();
              startPlayback();
              if (animationFrameId === null) animationFrameId = requestAnimationFrame(checkForFrame);
            }
          };
          document.addEventListener('visibilitychange', onVisibilityChange);
          armTimeout();
          animationFrameId = requestAnimationFrame(checkForFrame);
          // Register the observer before play: delayed play promises must not let media run ahead.
          startPlayback();
        });
      };

      let lastSampleTime = startTime - 0.005;
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        video.pause();
        await waitUntilPageVisible(report);
        const frameStartTimestamp = new Date().toISOString();
        const frameStartedAt = performance.now();
        const targetTime = getSampleTime(startTime, frameIndex, fps);
        const currentFrame = frameIndex + 1;
        report('FRAME_START', `frame=${currentFrame}/${totalFrames} targetSec=${targetTime.toFixed(3)}`);
        let seekMs = 0;
        let frameWaitMs = 0;
        let drawMs = 0;
        let previewSnapshotMs = 0;
        let currentTime: number;

        if (frameIndex === 0) {
          report('INITIAL_SEEK_START', `targetSec=${targetTime.toFixed(3)} currentSec=${video.currentTime.toFixed(3)}`);
          const seekStartedAt = performance.now();
          const seekCompletion = await seekTo(targetTime);
          seekMs = performance.now() - seekStartedAt;
          currentTime = video.currentTime;
          ({ drawMs, previewSnapshotMs } = captureVideoFrame());
          report('INITIAL_SEEK_END', `durationMs=${seekMs.toFixed(1)} completion=${seekCompletion} currentSec=${currentTime.toFixed(3)}`);
        } else {
          if (lastSampleTime >= duration - PLAYBACK_TIME_EPSILON_SECONDS) {
            report('PLAYBACK_ENDED', `framesCompleted=${results.length} lastSampleSec=${lastSampleTime.toFixed(3)} durationSec=${duration.toFixed(3)}`);
            break;
          }
          if (video.currentTime > endTime + PLAYBACK_TIME_EPSILON_SECONDS) {
            report('TRIM_ENDED', `framesCompleted=${results.length} currentSec=${video.currentTime.toFixed(3)}`);
            break;
          }
          const nextUniqueSampleTime = Math.max(targetTime, lastSampleTime + 0.005);
          report('PLAYBACK_FRAME_WAIT_START', `frame=${currentFrame} targetSec=${nextUniqueSampleTime.toFixed(3)} currentSec=${video.currentTime.toFixed(3)}`);
          let capturedFrame: Awaited<ReturnType<typeof waitForPlaybackFrame>>;
          try {
            capturedFrame = await waitForPlaybackFrame(nextUniqueSampleTime, lastSampleTime);
          } catch (error) {
            if (video.ended) {
              report('PLAYBACK_ENDED', `framesCompleted=${results.length} lastSampleSec=${lastSampleTime.toFixed(3)}`);
              break;
            }
            throw error;
          }
          ({ mediaTime: currentTime, frameWaitMs, drawMs, previewSnapshotMs } = capturedFrame);
          report('PLAYBACK_FRAME_READY', `frame=${currentFrame} mediaSec=${currentTime.toFixed(3)} waitMs=${frameWaitMs.toFixed(1)} source=raf`);
        }
        if (currentTime > endTime + PLAYBACK_TIME_EPSILON_SECONDS) {
          report('TRIM_ENDED', `framesCompleted=${results.length} currentSec=${currentTime.toFixed(3)}`);
          break;
        }
        lastSampleTime = currentTime;
        report('PROCESS_CANVAS_DRAW_END', `frame=${currentFrame} durationMs=${drawMs.toFixed(1)} input=${targetWidth}x${targetHeight}`);

        const timestampMs = Math.round(currentTime * 1000);

        let poses: NormalizedLandmark[][] = [];
        let worldPoses: NormalizedLandmark[][] = [];
        let hands: HandLandmarkResult[] = [];
        let poseMs = 0;
        let handMs = 0;

        try {
          // Processa o canvas reduzido com MediaPipe
          report('POSE_INFERENCE_START', `frame=${currentFrame}`);
          const poseStartedAt = performance.now();
          const poseResult = poseLandmarker.detectForVideo(processCanvas, timestampMs);
          poseMs = performance.now() - poseStartedAt;
          report('POSE_INFERENCE_END', `frame=${currentFrame} durationMs=${poseMs.toFixed(1)} poses=${poseResult.landmarks?.length ?? 0}`);

          poses = (poseResult.landmarks || []).map((landmarks: any[]) =>
            landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility, presence: l.presence }))
          );

          worldPoses = (poseResult.worldLandmarks || []).map((landmarks: any[]) =>
            landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility, presence: l.presence }))
          );

          if (handLandmarker) {
            report('HAND_INFERENCE_START', `frame=${currentFrame}`);
            const handStartedAt = performance.now();
            const handResult = handLandmarker.detectForVideo(processCanvas, timestampMs);
            handMs = performance.now() - handStartedAt;
            report('HAND_INFERENCE_END', `frame=${currentFrame} durationMs=${handMs.toFixed(1)} hands=${handResult.landmarks?.length ?? 0}`);
            hands = (handResult.landmarks || []).map((landmarks: any[], index: number) => {
              const handednessCategory = handResult.handednesses?.[index]?.[0]?.categoryName ?? 'Hand';
              return {
                handedness: handednessCategory,
                landmarks: landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z })),
              };
            });
          }
        } catch (detErr) {
          console.warn('Aviso: falha na detecção do frame', frameIndex, detErr);
          report('INFERENCE_FAILED', `frame=${currentFrame} error=${detErr instanceof Error ? detErr.message : String(detErr)}`);
        }

        // Ignore a single cold first inference. Repeated multi-second GPU stalls
        // make the interface unusable; retry on CPU without altering the chosen scale.
        slowPoseStreak = poseMs >= 2000 ? slowPoseStreak + 1 : 0;
        if (!usingCPU && !slowGPUFallbackAttempted && slowPoseStreak >= 2) {
          slowGPUFallbackAttempted = true;
          report('POSE_GPU_STALL_FALLBACK', `frame=${currentFrame} durationMs=${poseMs.toFixed(1)} slowFrames=${slowPoseStreak}`);
          try {
            const replacement = await createPoseLandmarker(Vision, vision, 'VIDEO', poseReporter, poseModel, 'CPU');
            const previousLandmarker = poseLandmarker;
            poseLandmarker = replacement;
            previousLandmarker.close();
          } catch (error) {
            report('POSE_GPU_STALL_FALLBACK_FAILED', error instanceof Error ? error.message : String(error));
          }
        }

        const frameResult: FrameResult = {
          timestampMs, poses, hands, worldPoses,
          imageSize: { width: targetWidth, height: targetHeight },
        };
        frameResult.poseAssessment = poseFilter.assess(frameResult);
        if (frameResult.poseAssessment.status !== 'accepted') {
          report('POSE_REJECTED', `frame=${currentFrame} reason=${frameResult.poseAssessment.reason}`);
        }
        // Só avança o preview depois de terminar a inferência do mesmo quadro.
        report('PREVIEW_DRAW_START', `frame=${currentFrame}`);
        const previewStartedAt = performance.now();
        if (previewCanvas && previewCtx && previewFrameCanvas) {
          previewCtx.drawImage(previewFrameCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
          drawAnalysisOverlay(previewCtx, frameResult.poseAssessment.status === 'accepted' ? poses : [], hands, previewCanvas.width, previewCanvas.height);
        }
        const previewMs = previewSnapshotMs + performance.now() - previewStartedAt;
        report('PREVIEW_DRAW_END', `frame=${currentFrame} durationMs=${previewMs.toFixed(1)}`);
        const frameEndTimestamp = new Date().toISOString();
        const totalMs = performance.now() - frameStartedAt;
        report('FRAME_END', `frame=${currentFrame}/${totalFrames} durationMs=${totalMs.toFixed(1)}`);

        results.push(frameResult);
        if (options?.onProgress) {
          options.onProgress({
            currentFrame,
            totalFrames,
            progress: Math.min(1, (currentTime - startTime) / processDuration),
            currentTimeMs: timestampMs,
            durationMs: Math.round(duration * 1000),
            frameResult,
            performance: {
              frameStartTimestamp,
              frameEndTimestamp,
              sourceWidth: video.videoWidth,
              sourceHeight: video.videoHeight,
              inputWidth: processCanvas.width,
              inputHeight: processCanvas.height,
              seekMs,
              frameWaitMs,
              drawMs,
              poseMs,
              handMs,
              previewMs,
              totalMs,
              setup,
            },
          });
        }

      }

      video.pause();
      return results;
    } finally {
      // Remove elemento de vídeo anexado ao DOM
      video.pause();
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
      // Libera os recursos das instâncias descartáveis da análise
      try {
        poseLandmarker.close();
        handLandmarker?.close();
      } catch (e) {
        // Ignora erros ao fechar
      }
    }
  },
};
