import EndpointToleranceControl from '@/components/endpoint-tolerance-control';
import { DEFAULT_ENDPOINT_TOLERANCE_PERCENT } from '../utils/endpoint-tolerance';
import { assertLocalVideoUri } from '../../modules/pose-tracker/src/local-media';
import React, { useRef, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
} from 'react-native';

import DocumentButton from '@/components/document-button';
import { styles } from '@/components/studio-styles';
import { StudioIcon, MovementIllustration } from '@/components/studio-visuals';
import VideoScreen from '@/components/video-screen';
import PoseOverlay from '@/components/pose-overlay';
import ExerciseSignals from '@/components/exercise-signals';
import AnalysisTimelineGraph from '@/components/analysis-timeline-graph';
import VideoAssessmentCard from '@/components/video-assessment-card';
import { assessVideo } from '../utils/video-assessment';
import { assessRepetitions, REPETITION_REFERENCES } from '../utils/repetition-feedback';
import PoseTracker, {
  PoseCameraView,
  FrameResult,
  ProcessingScale,
  PoseModel,
  VideoAnalysisOptions,
  VideoAnalysisProgress,
  DEFAULT_VIDEO_ANALYSIS_OPTIONS,
} from 'pose-tracker';
import {
  DEFAULT_JOINT_CANDIDATE_SELECTION_DURATION_MS,
  RepetitionCounter,
  type CompletedRepetition,
} from '../utils/repetition-counter';
import { EXERCISES, ExerciseType, getExerciseCounterOptions } from '../utils/exercises';
import { calculateAngle } from '../utils/biomechanics';
import { measureJoint } from '../utils/pose-measurement';
import { buildCounterTimeline, readCounterSnapshot } from '../utils/counter-timeline';
import { getEffectiveSampleRate } from '../../modules/pose-tracker/src/video-frame-helpers';
import type { VideoSeekRequest } from '../utils/video-playback';

const POSE_LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye',
  'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right', 'left_shoulder',
  'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_pinky',
  'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb', 'left_hip',
  'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel',
  'right_heel', 'left_foot_index', 'right_foot_index',
];

const ELBOW_JOINT_INDICES = {
  left: [11, 13, 15],
  right: [12, 14, 16],
} as const;

function getVisibleElbowAngle(frame: FrameResult, side: 'left' | 'right') {
  const measurement = measureJoint(frame, [...ELBOW_JOINT_INDICES[side]], true);
  return measurement ? calculateAngle(...measurement.points, measurement.use3D) : null;
}

function readRepStats(counter: RepetitionCounter, exercise: ExerciseType, endpointTolerancePercent = DEFAULT_ENDPOINT_TOLERANCE_PERCENT) {
  return readCounterSnapshot(counter, { ...getExerciseCounterOptions(exercise), endpointTolerancePercent });
}

export default function Index() {
  const [endpointTolerancePercent, setEndpointTolerancePercent] = useState(DEFAULT_ENDPOINT_TOLERANCE_PERCENT);
  const [benchWristTravel, setBenchWristTravel] = useState(false);
  const counterOptionsFor = (exercise: ExerciseType, travel = benchWristTravel, tolerance = endpointTolerancePercent) => ({ ...getExerciseCounterOptions(exercise), endpointTolerancePercent: tolerance, benchWristTravel: mode === 'video' && exercise.startsWith('bench_press') && travel });
  const [mode, setMode] = useState<'video' | 'camera'>('video');
  const [selectedExercise, setSelectedExercise] = useState<ExerciseType>('bicep_curl');
  const selectedExerciseRef = useRef<ExerciseType>('bicep_curl');
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasCompletedAnalysis, setHasCompletedAnalysis] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<VideoAnalysisProgress | null>(null);
  const [analysisLogText, setAnalysisLogText] = useState('');
  const [videoFrames, setVideoFrames] = useState<FrameResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Estados da Câmera ao vivo
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [liveFrame, setLiveFrame] = useState<FrameResult | null>(null);

  // Contador Biomecânico de Repetições
  const repCounterRef = React.useRef(
    new RepetitionCounter(getExerciseCounterOptions('bicep_curl'))
  );
  const analysisLogLinesRef = useRef<string[]>([]);
  const analysisConfigRef = useRef<{
    fps: number;
    poseModel?: PoseModel;
    benchWristTravel?: boolean;
    scale: ProcessingScale;
    detectHands: boolean;
    startTime: number;
    endTime: number;
  } | null>(null);
  const analysisStageDurationsRef = useRef<Record<string, number[]>>({});
  const previousProgressCallbackAtRef = useRef<number | null>(null);
  const previousProgressCallbackDurationRef = useRef<number>(0);

  const [repStats, setRepStats] = useState(() => readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));

  const replayTimeline = React.useMemo(() => buildCounterTimeline(videoFrames, counterOptionsFor(selectedExercise)), [videoFrames, selectedExercise, benchWristTravel, endpointTolerancePercent, mode]);
  const repetitionFeedback = React.useMemo(() => assessRepetitions(replayTimeline.snapshots, replayTimeline.repetitions, selectedExercise, endpointTolerancePercent), [replayTimeline, selectedExercise, endpointTolerancePercent]);
  const videoAssessment = React.useMemo(() => assessVideo(videoFrames, replayTimeline.snapshots, counterOptionsFor(selectedExercise), replayTimeline.repetitions.length), [videoFrames, replayTimeline, selectedExercise, benchWristTravel, endpointTolerancePercent, mode]);
  const [playbackTimestampMs, setPlaybackTimestampMs] = useState(0);
  const [seekRequest, setSeekRequest] = useState<VideoSeekRequest | null>(null);
  const handlePlaybackFrameChange = React.useCallback((frame: FrameResult) => {
    setPlaybackTimestampMs(frame.timestampMs);
    const snapshot = replayTimeline.snapshots.get(frame.timestampMs);
    if (snapshot) setRepStats(snapshot);
  }, [replayTimeline]);
  const selectGraphTimestamp = (timestampMs: number) => {
    setPlaybackTimestampMs(timestampMs);
    const snapshot = replayTimeline.snapshots.get(timestampMs);
    if (snapshot) setRepStats(snapshot);
    setSeekRequest((previous) => ({ timestampMs, id: (previous?.id ?? 0) + 1 }));
  };
  const playRepetition = (repetition: CompletedRepetition) => {
    setPlaybackTimestampMs(repetition.startTimestampMs);
    const snapshot = replayTimeline.snapshots.get(repetition.startTimestampMs);
    if (snapshot) setRepStats(snapshot);
    setSeekRequest((previous) => ({ timestampMs: repetition.startTimestampMs, endTimestampMs: repetition.endTimestampMs, id: (previous?.id ?? 0) + 1 }));
  };

  const { width } = useWindowDimensions();
  const defaultCameraWidth = Math.min(width - 80, 400);
  const [cameraDimensions, setCameraDimensions] = useState<{ width: number; height: number }>({
    width: defaultCameraWidth,
    height: Math.round(defaultCameraWidth * 0.75), // padrão 4:3 webcam
  });

  const handleCameraReady = React.useCallback(
    (dimensions: { width: number; height: number; aspectRatio: number }) => {
      const maxW = Math.min(width - 80, 420);
      const h = Math.round(maxW / (dimensions.aspectRatio || 1.33));
      setCameraDimensions({ width: maxW, height: h });
    },
    [width]
  );

  const previewCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const monotonicNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const appendAnalysisLog = (line: string, refresh = false) => {
    analysisLogLinesRef.current.push(line);
    if (refresh) {
      setAnalysisLogText(analysisLogLinesRef.current.slice(-100).join('\n'));
    }
  };

  const formatTimingSummary = () =>
    Object.entries(analysisStageDurationsRef.current)
      .map(([stage, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
        const max = sorted[sorted.length - 1];
        return `${stage}[avg=${average.toFixed(1)} p95=${p95.toFixed(1)} max=${max.toFixed(1)}ms]`;
      })
      .join(' ');

  const handleVideoSelected = (uri: string) => {
    try { assertLocalVideoUri(uri, Platform.OS === 'web' ? 'web' : 'native', Platform.OS === 'web' ? window.location.origin : undefined); }
    catch (error) { setErrorMessage(error instanceof Error ? error.message : String(error)); return; }
    setVideoUri(uri);
    setIsAnalyzing(false);
    setAnalysisProgress(null);
    analysisLogLinesRef.current = [];
    analysisConfigRef.current = null;
    setAnalysisLogText('');
    setErrorMessage(null);
    setVideoFrames([]);
    setHasCompletedAnalysis(false);
    repCounterRef.current.reset();
    setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));
  };

  const replayFramesForCounter = (frames: FrameResult[], exercise = selectedExercise) => {
    repCounterRef.current.reset();
    frames.forEach((frame) => repCounterRef.current.processFrame(frame));
    repCounterRef.current.finishPendingJointSelection();
    setRepStats(readRepStats(repCounterRef.current, exercise, endpointTolerancePercent));
  };

  const handleToleranceChange = (value: number) => {
    setEndpointTolerancePercent(value);
    repCounterRef.current = new RepetitionCounter(counterOptionsFor(selectedExercise, benchWristTravel, value));
    if (mode === 'video') {
      videoFrames.forEach(frame => repCounterRef.current.processFrame(frame));
      repCounterRef.current.finishPendingJointSelection();
    }
    setRepStats(readRepStats(repCounterRef.current, selectedExercise, value));
    if (videoFrames.length && mode === 'video') appendAnalysisLog(`[${new Date().toISOString()}] COUNTER_RECALCULATED endpointTolerancePercent=${value} repetitions=${repCounterRef.current.getRepCount()}`, true);
  };

  const handleExerciseChange = (exercise: ExerciseType) => {
    selectedExerciseRef.current = exercise;
    setSelectedExercise(exercise);
    repCounterRef.current = new RepetitionCounter(counterOptionsFor(exercise));
    if (mode === 'video' && videoFrames.length > 0 && !isAnalyzing) {
      replayFramesForCounter(videoFrames, exercise);
    } else {
      setRepStats(readRepStats(repCounterRef.current, exercise, endpointTolerancePercent));
    }
  };

  const handleModeChange = (nextMode: 'video' | 'camera') => {
    setMode(nextMode);
    repCounterRef.current = new RepetitionCounter({ ...getExerciseCounterOptions(selectedExercise), endpointTolerancePercent, benchWristTravel: nextMode === 'video' && selectedExercise.startsWith('bench_press') && benchWristTravel });
    setLiveFrame(null);
    if (nextMode === 'video' && videoFrames.length > 0 && !isAnalyzing) {
      replayFramesForCounter(videoFrames);
    } else {
      repCounterRef.current.reset();
      setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));
    }
  };

  const handleStartAnalysis = async (config: {
    fps: number;
    poseModel?: PoseModel;
    benchWristTravel?: boolean;
    scale: ProcessingScale;
    detectHands: boolean;
    startTime: number;
    endTime: number;
  }) => {
    if (!videoUri) return;
    setBenchWristTravel(config.benchWristTravel ?? false);
    repCounterRef.current = new RepetitionCounter(counterOptionsFor(selectedExercise, config.benchWristTravel ?? false));
    const poseModel = config.poseModel ?? DEFAULT_VIDEO_ANALYSIS_OPTIONS.poseModel;
    analysisConfigRef.current = { ...config, poseModel };
    const analysisStartedAt = monotonicNow();
    const startedAtText = new Date().toISOString();
    analysisStageDurationsRef.current = {};
    previousProgressCallbackAtRef.current = null;
    previousProgressCallbackDurationRef.current = 0;
    analysisLogLinesRef.current = [
      `[${startedAtText}] ANALYSIS_START`,
      `[${startedAtText}] CONFIG exercise=${selectedExercise} fps=${config.fps} model=${poseModel} scale=${config.scale} hands=${config.detectHands} wristTravel=${config.benchWristTravel ?? false} endpointTolerancePercent=${endpointTolerancePercent} trim=${config.startTime.toFixed(3)}..${config.endTime.toFixed(3)}s`,
    ];
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      const browser = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { effectiveType?: string; rtt?: number; downlink?: number };
      };
      analysisLogLinesRef.current.push(
        `[${startedAtText}] ENV userAgent=${JSON.stringify(browser.userAgent)} hardwareConcurrency=${browser.hardwareConcurrency ?? 'unknown'} deviceMemoryGB=${browser.deviceMemory ?? 'unknown'} devicePixelRatio=${window.devicePixelRatio ?? 'unknown'} viewport=${window.innerWidth}x${window.innerHeight} connection=${browser.connection?.effectiveType ?? 'unknown'} rttMs=${browser.connection?.rtt ?? 'unknown'} downlinkMbps=${browser.connection?.downlink ?? 'unknown'}`
      );
    }
    setAnalysisLogText(analysisLogLinesRef.current.join('\n'));
    setIsAnalyzing(true);
    setAnalysisProgress(null);
    setErrorMessage(null);
    setVideoFrames([]);
    setHasCompletedAnalysis(false);
    repCounterRef.current.reset();
    setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));

    // Pequena pausa para garantir montagem do canvas no DOM
    await new Promise((resolve) => setTimeout(resolve, 80));

    try {
      const analysisOptions: VideoAnalysisOptions = {
        fps: config.fps,
        poseModel,
        scale: config.scale,
        detectHands: config.detectHands,
        startTime: config.startTime,
        endTime: config.endTime,
      };
      if (Platform.OS === 'web') {
        analysisOptions.onDiagnostic = (event) => {
          const isFrameEvent = /\bframe=\d/.test(event);
          appendAnalysisLog(event, !isFrameEvent);
        };
        analysisOptions.previewCanvas = previewCanvasRef.current;
        analysisOptions.onProgress = (progress) => {
          const callbackStartedAt = monotonicNow();
          const previousCallbackAt = previousProgressCallbackAtRef.current;
          const previousCallbackDuration = previousProgressCallbackDurationRef.current;
          previousProgressCallbackAtRef.current = callbackStartedAt;
          setAnalysisProgress(progress);
          repCounterRef.current.processFrame(progress.frameResult);
          setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));

          const timings = progress.performance;
          const callbackMs = monotonicNow() - callbackStartedAt;
          if (timings) {
            const callbackGapMs = previousCallbackAt === null ? null : callbackStartedAt - previousCallbackAt;
            const outsideModuleMs = callbackGapMs === null
              ? null
              : Math.max(0, callbackGapMs - previousCallbackDuration - timings.totalMs);
            const stages: Record<string, number> = {
              seek: timings.seekMs,
              frameWait: timings.frameWaitMs,
              draw: timings.drawMs,
              pose: timings.poseMs,
              hands: timings.handMs,
              preview: timings.previewMs,
              moduleFrame: timings.totalMs,
              appCallback: callbackMs,
            };
            if (outsideModuleMs !== null) stages.outsideModuleEstimate = outsideModuleMs;
            for (const [stage, durationMs] of Object.entries(stages)) {
              (analysisStageDurationsRef.current[stage] ??= []).push(durationMs);
            }
            const setup = progress.currentFrame === 1
              ? ` setup[sdk=${timings.setup.sdkMs.toFixed(1)} wasm=${timings.setup.wasmMs.toFixed(1)} poseModel=${timings.setup.poseModelMs.toFixed(1)} handModel=${timings.setup.handModelMs.toFixed(1)} metadata=${timings.setup.videoMetadataMs.toFixed(1)} canvas=${timings.setup.canvasMs.toFixed(1)} total=${timings.setup.totalMs.toFixed(1)}ms]`
              : '';
            appendAnalysisLog(
              `[${timings.frameStartTimestamp}..${timings.frameEndTimestamp}] FRAME ${progress.currentFrame}/${progress.totalFrames} video=${(progress.currentTimeMs / 1000).toFixed(3)}s source=${timings.sourceWidth}x${timings.sourceHeight} input=${timings.inputWidth}x${timings.inputHeight} seek=${timings.seekMs.toFixed(1)}ms frameWait=${timings.frameWaitMs.toFixed(1)}ms draw=${timings.drawMs.toFixed(1)}ms pose=${timings.poseMs.toFixed(1)}ms hands=${timings.handMs.toFixed(1)}ms preview=${timings.previewMs.toFixed(1)}ms moduleTotal=${timings.totalMs.toFixed(1)}ms appCallback=${callbackMs.toFixed(1)}ms callbackGap=${callbackGapMs?.toFixed(1) ?? 'n/a'}ms outsideModule~=${outsideModuleMs?.toFixed(1) ?? 'n/a'}ms${setup}`,
              progress.currentFrame === 1 || progress.currentFrame === progress.totalFrames || progress.currentFrame % 10 === 0
            );
          }
          previousProgressCallbackDurationRef.current = callbackMs;
        };
      }

      const frames = await PoseTracker.analyzeVideo(videoUri, analysisOptions);
      const elapsedMs = monotonicNow() - analysisStartedAt;
      const actualFps = elapsedMs > 0 ? (frames.length * 1000) / elapsedMs : 0;
      appendAnalysisLog(
        `[${new Date().toISOString()}] ANALYSIS_RESULT frames=${frames.length} mediaSampleFps=${getEffectiveSampleRate(frames)?.toFixed(2) ?? 'n/a'} elapsed=${elapsedMs.toFixed(1)}ms avg=${frames.length ? (elapsedMs / frames.length).toFixed(1) : 'n/a'}ms/frame throughput=${actualFps.toFixed(2)}frames/s`,
        false
      );
      appendAnalysisLog(
        `[${new Date().toISOString()}] STAGE_SUMMARY ${formatTimingSummary() || 'timings unavailable on native backend'}`,
        true
      );
      if (Platform.OS !== 'web') {
        for (const frame of frames) {
          repCounterRef.current.processFrame(frame);
        }
      }
      repCounterRef.current.finishPendingJointSelection();
      setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));
      setVideoFrames(frames);
      setHasCompletedAnalysis(true);
    } catch (err: any) {
      console.error('Falha ao analisar vídeo:', err);
      appendAnalysisLog(
        `[${new Date().toISOString()}] +${(monotonicNow() - analysisStartedAt).toFixed(1)}ms ANALYSIS_ERROR ${err?.stack || err?.message || String(err)}`,
        false
      );
      appendAnalysisLog(
        `[${new Date().toISOString()}] STAGE_SUMMARY_PARTIAL ${formatTimingSummary() || 'no frame timings recorded'}`,
        true
      );
      setErrorMessage(err?.message || 'Falha ao analisar vídeo');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleResetAnalysis = () => {
    setVideoFrames([]);
    setHasCompletedAnalysis(false);
    analysisConfigRef.current = null;
    repCounterRef.current.reset();
    setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));
  };

  const handleLiveFrameResult = React.useCallback(
    (event: { nativeEvent: FrameResult }) => {
      repCounterRef.current.processFrame(event.nativeEvent);
      setLiveFrame({ ...event.nativeEvent, poses: repCounterRef.current.getPoseAssessment().status === 'accepted' ? event.nativeEvent.poses : [] });
      setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));
    },
    [selectedExercise, endpointTolerancePercent]
  );

  const resetReps = () => {
    repCounterRef.current.reset();
    setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));
  };

  const toggleFacing = () => {
    repCounterRef.current.reset();
    setRepStats(readRepStats(repCounterRef.current, selectedExercise, endpointTolerancePercent));
    setCameraFacing((prev) => (prev === 'front' ? 'back' : 'front'));
  };

  const downloadAnalysisLog = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const blob = new Blob([analysisLogLinesRef.current.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `repcounter-analysis-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const downloadKeypointJson = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || videoFrames.length === 0) return;

    const exercise = selectedExerciseRef.current;
    const counterOptions = counterOptionsFor(exercise);
    const counter = new RepetitionCounter(counterOptions);
    const frames = videoFrames.map((frame, frameIndex) => {
      counter.processFrame(frame);
      return {
        frame: frameIndex + 1,
        timestampMs: frame.timestampMs,
        imageSize: frame.imageSize,
        worldPoses: frame.worldPoses,
        poseAssessment: counter.getPoseAssessment(),
        posture: counter.getPostureAssessment(),
        timestampSec: Number((frame.timestampMs / 1000).toFixed(3)),
        poses: frame.poses.map((pose) => ({
          landmarks: pose.map((point, index) => ({
            index,
            name: POSE_LANDMARK_NAMES[index] ?? `landmark_${index}`,
            x: point.x,
            y: point.y,
            z: point.z,
            ...(point.visibility === undefined ? {} : { visibility: point.visibility }),
            ...(point.presence === undefined ? {} : { presence: point.presence }),
          })),
        })),
        hands: frame.hands.map((hand) => ({
          handedness: hand.handedness,
          landmarks: hand.landmarks.map((point, index) => ({
            index,
            x: point.x,
            y: point.y,
            z: point.z,
            ...(point.visibility === undefined ? {} : { visibility: point.visibility }),
            ...(point.presence === undefined ? {} : { presence: point.presence }),
          })),
        })),
        elbowAnglesDeg: {
          left: frame.poses[0] ? getVisibleElbowAngle(frame, 'left') : null,
          right: frame.poses[0] ? getVisibleElbowAngle(frame, 'right') : null,
        },
        counter: {
          exercise,
          selectedSide: counter.getActiveJointSide(),
          angleQuality: counter.getAngleQuality(),
          measurementSpace: counter.getMeasurementSpace(),
          angleValid: counter.hasCurrentAngle(),
          angleDeg: Number(counter.getCurrentAngle().toFixed(1)),
          state: counter.getState(),
          repetitions: counter.getRepCount(),
          progressPercent: Number(counter.getCurrentRepProgress().toFixed(1)),
        },
      };
    });
    counter.finishPendingJointSelection();
    const selectedSide = counter.getActiveJointSide();
    const payload = {
      format: 'repcounter-keypoints',
      version: 4,
      generatedAt: new Date().toISOString(),
      coordinateSystem: {
        x: 'normalizado de 0 a 1, origem à esquerda',
        y: 'normalizado de 0 a 1, origem no topo',
        z: 'profundidade relativa estimada pelo MediaPipe',
        worldPoses: 'coordenadas 3D estimadas em metros, com origem no quadril',
        timestamp: 'tempo do vídeo em milissegundos e segundos',
      },
      analysis: { ...analysisConfigRef.current, endpointTolerancePercent, effectiveSampleFps: getEffectiveSampleRate(videoFrames) },
      videoAssessment,
      repetitionFeedback: {
        scope: 'Amplitude angular estimada; não certifica técnica completa ou segurança.',
        reference: REPETITION_REFERENCES[exercise],
        toleranceNote: 'Percentual ajustável do app, sem validação científica dessa margem.',
        items: repetitionFeedback,
      },
      poseLandmarkNames: POSE_LANDMARK_NAMES,
      counterReplay: {
        endpointTolerancePercent,
        exercise,
        selectedSide,
        frameCount: frames.length,
        sideSelectionWindowMs: counterOptions.jointIndexCandidates?.length
          ? counterOptions.jointCandidateSelectionDurationMs ?? DEFAULT_JOINT_CANDIDATE_SELECTION_DURATION_MS
          : 0,
        repetitions: counter.getRepCount(),
        intervals: counter.getCompletedRepetitions(),
      },
      frames,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `repcounter-keypoints-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, width < 600 && styles.compactContainer]}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandMark}><StudioIcon color="#18230E" size={25} /></View>
          <View><Text style={styles.brandName}>RepCounter<Text style={{ color: '#C5F566' }}>.</Text></Text><Text style={styles.brandSub}>MOVEMENT STUDIO</Text></View>
        </View>
        <View style={styles.localBadge}><View style={styles.localDot} /><Text style={styles.localText}>Análise local</Text></View>
      </View>
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>VISÃO COMPUTACIONAL · BIOMECÂNICA</Text>
        <Text style={[styles.title, width < 600 && { fontSize: 29, lineHeight: 36 }]}>Cada movimento conta.</Text>
        <Text style={styles.subtitle}>Transforme seu treino em dados. Entenda o movimento, uma repetição por vez.</Text>
      </View>
      <View style={[styles.dashboard, width >= 960 && styles.desktopDashboard]}>
        <View style={[styles.sidebar, width >= 960 && styles.desktopSidebar]}>
          <View style={styles.controlCard}>
            <Text style={styles.sectionLabel}>01 / FONTE DO MOVIMENTO</Text>
            <View style={[styles.tabContainer, width < 960 && { flexDirection: 'row', flexWrap: 'wrap' }]}>
              {(['video', 'camera'] as const).map((source) => (
                <TouchableOpacity key={source} accessibilityRole="button" accessibilityState={{ selected: mode === source, disabled: isAnalyzing }} style={[styles.tabButton, width < 960 && { flex: 1, minWidth: 140 }, mode === source && styles.tabButtonActive]} disabled={isAnalyzing} onPress={() => handleModeChange(source)}>
                  <StudioIcon name={source} size={18} color={mode === source ? '#C5F566' : '#8A9A87'} />
                  <Text style={[styles.tabText, mode === source && styles.tabTextActive]}>{source === 'video' ? (width < 600 ? 'Vídeo' : 'Arquivo de vídeo') : 'Câmera ao vivo'}</Text>
                  {mode === source && <View style={styles.selectedDot} />}
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.controlCard}>
            <Text style={styles.sectionLabel}>02 / SEU EXERCÍCIO</Text>
            <View style={[styles.exerciseSelector, width < 960 && { flexDirection: 'row', flexWrap: 'wrap' }]}>
              {EXERCISES.map((exercise, index) => (
                <TouchableOpacity key={exercise.id} accessibilityRole="button" accessibilityState={{ selected: selectedExercise === exercise.id, disabled: isAnalyzing }} disabled={isAnalyzing} style={[styles.exerciseButton, selectedExercise === exercise.id && styles.exerciseButtonActive]} onPress={() => handleExerciseChange(exercise.id)}>
                  {width >= 960 && <Text style={styles.exerciseNumber}>{String(index + 1).padStart(2, '0')}</Text>}
                  <Text style={[styles.exerciseText, width < 960 && { flex: 0 }, selectedExercise === exercise.id && styles.exerciseTextActive]}>{exercise.label}</Text>
                  {width >= 960 && selectedExercise === exercise.id && <StudioIcon name="arrow" size={15} />}
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.sidebarNote}>Enquadre o corpo inteiro e mantenha a câmera estável para uma leitura melhor.</Text>
          </View>
          {width >= 960 && <ExerciseSignals stats={repStats} />}
        </View>
        <View style={[styles.workspace, width >= 960 && styles.desktopWorkspace]}>
          <View style={styles.workspaceHeader}>
            <View><Text style={styles.workspaceTitle}>{EXERCISES.find(exercise => exercise.id === selectedExercise)?.label}</Text><Text style={styles.workspaceMeta}>{mode === 'video' ? 'Análise de vídeo' : 'Captura em tempo real'}</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={styles.sessionBadge}>{isAnalyzing ? 'PROCESSANDO' : videoFrames.length > 0 && mode === 'video' ? 'ANÁLISE CONCLUÍDA' : mode === 'camera' ? 'AO VIVO' : 'NOVA SESSÃO'}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Zerar repetições" style={styles.resetButton} disabled={isAnalyzing} onPress={resetReps}><Text style={styles.resetButtonText}>Zerar</Text></TouchableOpacity></View>
          </View>
      <View style={styles.metricsCard}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>REPETIÇÕES</Text>
          <Text style={styles.metricValue}>{repStats.reps}</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>ÂNGULO</Text>
          <Text style={styles.metricValueSecondary}>
            {repStats.quality === 'unavailable' ? '—' : `${repStats.quality === 'estimated' ? '≈' : ''}${repStats.angle}°`}
          </Text>
          <Text style={styles.metricLabel}>
            {repStats.quality === 'unavailable' ? 'Sem leitura' : `${repStats.space === 'world' ? '3D' : '2D'} · ${repStats.quality === 'estimated' ? 'Estimado' : 'Detectado'}`}
          </Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={[styles.metricItem, { flex: 1.2 }]}>
          <Text style={styles.metricLabel}>PROGRESSO</Text>
          <View style={styles.repProgressBar}>
            <View style={[styles.repProgressFill, { width: `${repStats.progress}%` }]} />
          </View>
        </View>


      </View>

          {width < 960 && <ExerciseSignals stats={repStats} />}
          {!(selectedExercise.startsWith('bench_press') && benchWristTravel && mode === 'video') && <EndpointToleranceControl
            value={endpointTolerancePercent} min={getExerciseCounterOptions(selectedExercise).minAngleThreshold}
            max={getExerciseCounterOptions(selectedExercise).maxAngleThreshold} disabled={isAnalyzing} recalculate={mode === 'video'} onChange={handleToleranceChange} />}

      {mode === 'video' ? (
        <View style={styles.content}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelLabel}>ÁREA DE ANÁLISE</Text>
            {videoUri && <DocumentButton buttonTitle="Trocar vídeo" documentCallback={handleVideoSelected} disabled={isAnalyzing} compact />}
          </View>

          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          {videoUri ? (
            <View style={styles.videoSection}>
              <VideoScreen
                allowBenchWristTravel={selectedExercise.startsWith('bench_press')}
                videoSource={videoUri}
                frameResults={replayTimeline.displayFrames}
                isAnalyzing={isAnalyzing}
                analysisProgress={analysisProgress}
                previewCanvasRef={previewCanvasRef}
                onStartAnalysis={handleStartAnalysis}
                onResetAnalysis={handleResetAnalysis}
                onFrameChange={handlePlaybackFrameChange}
                seekRequest={seekRequest}
              />
              {!isAnalyzing && hasCompletedAnalysis && <VideoAssessmentCard assessment={videoAssessment} />}
              {!isAnalyzing && videoFrames.length > 0 && (
                <AnalysisTimelineGraph frames={videoFrames} snapshots={replayTimeline.snapshots} repetitions={replayTimeline.repetitions} feedback={repetitionFeedback} reference={REPETITION_REFERENCES[selectedExercise]} tolerancePercent={endpointTolerancePercent} selectedTimestampMs={playbackTimestampMs} onSelectTimestamp={selectGraphTimestamp} onPlayRepetition={playRepetition} />
              )}
              {analysisLogText.length > 0 && (
                <View style={styles.analysisLogPanel}>
                  <View style={styles.analysisLogHeader}>
                    <Text style={styles.analysisLogTitle}>
                      Log de diagnóstico · {analysisLogLinesRef.current.length} linhas
                    </Text>
                    {Platform.OS === 'web' && (
                      <View style={styles.analysisLogActions}>
                        {videoFrames.length > 0 && (
                          <TouchableOpacity style={styles.downloadJsonButton} onPress={downloadKeypointJson}>
                            <Text style={styles.downloadLogText}>Keypoints .json</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={styles.downloadLogButton} onPress={downloadAnalysisLog}>
                          <Text style={styles.downloadLogText}>Log .txt</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  <ScrollView style={styles.analysisLogScroll} nestedScrollEnabled>
                    <Text selectable style={styles.analysisLogText}>{analysisLogText}</Text>
                  </ScrollView>
                </View>
              )}
            </View>
          ) : (
            <>
              <View style={styles.emptyState}>
                <View style={styles.illustration}><MovementIllustration /></View>
                <Text style={styles.emptyTitle}>Seu movimento, em detalhe.</Text>
                <Text style={styles.emptyDescription}>Adicione um vídeo para acompanhar sua postura, medir ângulos e contar cada repetição.</Text>
                <DocumentButton buttonTitle="Selecionar vídeo" documentCallback={handleVideoSelected} disabled={isAnalyzing} />
                <Text style={styles.emptyHint}>Escolha um arquivo de vídeo do seu dispositivo</Text>
              </View>
              <View style={styles.steps}>
                <View style={styles.step}><Text style={styles.stepNumber}>01 / PREPARE</Text><Text style={styles.stepTitle}>Escolha o exercício</Text><Text style={styles.stepDescription}>Selecione o movimento que aparece no vídeo.</Text></View>
                <View style={styles.step}><Text style={styles.stepNumber}>02 / ANALISE</Text><Text style={styles.stepTitle}>Defina o trecho</Text><Text style={styles.stepDescription}>Ajuste o intervalo e inicie a detecção.</Text></View>
                <View style={styles.step}><Text style={styles.stepNumber}>03 / EXPLORE</Text><Text style={styles.stepTitle}>Veja suas repetições</Text><Text style={styles.stepDescription}>Confira ângulos e reveja cada movimento.</Text></View>
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={styles.content}>
          <View
            style={[
              styles.cameraContainer,
              { width: cameraDimensions.width, height: cameraDimensions.height },
            ]}
          >
            <PoseCameraView
              facing={cameraFacing}
              active={mode === 'camera'}
              onFrameResult={handleLiveFrameResult}
              onCameraReady={handleCameraReady}
              style={StyleSheet.absoluteFill}
            />

            {liveFrame && (
              <PoseOverlay
                poses={liveFrame.poses}
                hands={liveFrame.hands}
                width={cameraDimensions.width}
                height={cameraDimensions.height}
                mirrored={cameraFacing === 'front'}
              />
            )}
          </View>

          <View style={styles.cameraControls}>
            <TouchableOpacity style={styles.switchButton} onPress={toggleFacing}>
              <Text style={styles.switchButtonText}>
                Inverter Câmera ({cameraFacing === 'front' ? 'Frontal' : 'Traseira'})
              </Text>
            </TouchableOpacity>

            {liveFrame && (
              <Text style={styles.statsText}>
                Poses: {liveFrame.poses?.length || 0} | Mãos: {liveFrame.hands?.length || 0}
              </Text>
            )}
          </View>
        </View>
      )}
        </View>
      </View>
      <View style={styles.footer}><Text style={styles.footerText}>RepCounter · Movimento em perspectiva</Text><Text style={styles.footerText}>Pose por MediaPipe · A contagem depende da qualidade da captura</Text></View>
    </ScrollView>
  );
}
