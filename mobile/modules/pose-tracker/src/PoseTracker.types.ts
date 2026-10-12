import { ViewProps } from 'react-native';
import type { ProcessingScale } from './video-frame-helpers';
export type { ProcessingScale } from './video-frame-helpers';

export type NormalizedLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
};

/** Coordenadas métricas estimadas pelo MediaPipe, com origem no quadril. */
export type WorldLandmark = NormalizedLandmark;

export type HandLandmarkResult = {
  handedness: 'Left' | 'Right' | string;
  landmarks: NormalizedLandmark[];
};

export type FrameResult = {
  timestampMs: number;
  poses: NormalizedLandmark[][];
  hands: HandLandmarkResult[];
  worldPoses?: WorldLandmark[][];
  imageSize?: { width: number; height: number };
  poseAssessment?: PoseAssessment;
};

export type PoseAssessment = {
  status: 'accepted' | 'rejected' | 'acquiring';
  reason?: 'missing-pose' | 'invalid-timestamp' | 'body-flip' | 'body-scale' | 'body-jump' | 'reacquiring' | 'joint-jump';
};

export type PoseModel = 'lite' | 'full' | 'heavy';

export type VideoAnalysisProgress = {
  currentFrame: number;
  totalFrames: number;
  progress: number; // 0..1
  currentTimeMs: number;
  durationMs: number;
  frameResult: FrameResult;
  performance?: {
    frameStartTimestamp: string;
    frameEndTimestamp: string;
    sourceWidth: number;
    sourceHeight: number;
    inputWidth: number;
    inputHeight: number;
    seekMs: number;
    frameWaitMs: number;
    drawMs: number;
    poseMs: number;
    handMs: number;
    previewMs: number;
    totalMs: number;
    setup: {
      sdkMs: number;
      wasmMs: number;
      poseModelMs: number;
      handModelMs: number;
      videoMetadataMs: number;
      canvasMs: number;
      totalMs: number;
    };
  };
};

export type VideoAnalysisOptions = {
  poseModel?: PoseModel; // vídeos Web/Android/iOS: full por padrão; câmera ao vivo usa lite
  fps?: number; // inteiro de 1 a 60; padrão: 8
  scale?: ProcessingScale; // escala proporcional do vídeo (padrão: 1/3)
  detectHands?: boolean; // detectar mãos no vídeo; padrão: false
  startTime?: number; // tempo de início em segundos (padrão: 0)
  endTime?: number; // tempo de fim em segundos (padrão: fim do vídeo)
  previewCanvas?: any;
  onDiagnostic?: (event: string) => void;
  onProgress?: (progress: VideoAnalysisProgress) => void;
};

export type PoseCameraViewProps = ViewProps & {
  facing?: 'front' | 'back';
  active?: boolean;
  onFrameResult?: (event: { nativeEvent: FrameResult }) => void;
  onCameraReady?: (dimensions: { width: number; height: number; aspectRatio: number }) => void;
};
