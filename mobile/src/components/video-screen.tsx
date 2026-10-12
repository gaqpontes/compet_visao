import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { FrameResult, ProcessingScale, PoseModel, VideoAnalysisProgress, DEFAULT_VIDEO_ANALYSIS_OPTIONS } from 'pose-tracker';
import PoseOverlay from './pose-overlay';
import type { VideoSeekRequest } from '../utils/video-playback';

export type AnalysisConfig = {
  poseModel?: PoseModel;
  fps: number;
  scale: ProcessingScale;
  detectHands: boolean;
  startTime: number;
  endTime: number;
};

export type VideoScreenProps = {
  allowBenchWristTravel?: boolean;
  videoSource: string;
  frameResults?: FrameResult[];
  isAnalyzing?: boolean;
  analysisProgress?: VideoAnalysisProgress | null;
  previewCanvasRef?: any;
  onStartAnalysis?: (config: AnalysisConfig) => void;
  onResetAnalysis?: () => void;
  onFrameChange?: (frame: FrameResult) => void;
  seekRequest?: VideoSeekRequest | null;
};

const PROCESSING_SCALES: { scale: ProcessingScale; label: string }[] = [
  { scale: 'one-third', label: '1/3' },
  { scale: 'two-thirds', label: '2/3' },
  { scale: 'original', label: '1×' },
];
const FPS_OPTIONS = [6, 8, 10, 12, 15, 20, 24, 30];

const formatSeconds = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
};

export default function VideoScreen({
  videoSource,
  frameResults,
  isAnalyzing = false,
  analysisProgress,
  onStartAnalysis,
  onResetAnalysis,
  onFrameChange,
  seekRequest,
}: VideoScreenProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [currentFrame, setCurrentFrame] = useState<FrameResult | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [selectedFps, setSelectedFps] = useState(DEFAULT_VIDEO_ANALYSIS_OPTIONS.fps);
  const [selectedPoseModel, setSelectedPoseModel] = useState<PoseModel>(DEFAULT_VIDEO_ANALYSIS_OPTIONS.poseModel);
  const [selectedScale, setSelectedScale] = useState<ProcessingScale>(DEFAULT_VIDEO_ANALYSIS_OPTIONS.scale);
  const [detectHands, setDetectHands] = useState(DEFAULT_VIDEO_ANALYSIS_OPTIONS.detectHands);
  const [videoAspectRatio, setVideoAspectRatio] = useState(4 / 3);
  const hasAnalysis = Boolean(frameResults?.length);
  const segmentEndMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAnalyzing && currentFrame) onFrameChange?.(currentFrame);
  }, [currentFrame, isAnalyzing, onFrameChange]);

  const player = useVideoPlayer(videoSource, (videoPlayer) => {
    videoPlayer.loop = false;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const sourceLoad = useEvent(player, 'sourceLoad');
  const timeUpdate = useEvent(player, 'timeUpdate');

  useEffect(() => {
    if (!seekRequest || isAnalyzing || !frameResults?.length) return;
    player.pause();
    segmentEndMsRef.current = seekRequest.endTimestampMs ?? null;
    player.currentTime = seekRequest.timestampMs / 1000;
    setCurrentTime(seekRequest.timestampMs / 1000);
    if (seekRequest.endTimestampMs !== undefined) player.play();
  }, [seekRequest, frameResults, isAnalyzing, player]);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.2;
    return () => {
      player.timeUpdateEventInterval = 0;
    };
  }, [player]);

  useEffect(() => {
    if (isAnalyzing) player.pause();
  }, [isAnalyzing, player]);

  useEffect(() => {
    if (!sourceLoad) return;
    const videoSize = sourceLoad.availableVideoTracks.find((track) => track.size.width > 0)?.size;
    if (videoSize) setVideoAspectRatio(videoSize.width / videoSize.height);
    setDuration(sourceLoad.duration);
    setTrimStart(0);
    setTrimEnd(sourceLoad.duration);
  }, [sourceLoad]);

  useEffect(() => {
    if (!timeUpdate) return;
    const segmentEndMs = segmentEndMsRef.current;
    if (segmentEndMs !== null && timeUpdate.currentTime * 1000 >= segmentEndMs) {
      player.pause();
      player.currentTime = segmentEndMs / 1000;
      setCurrentTime(segmentEndMs / 1000);
      segmentEndMsRef.current = null;
      return;
    }
    if (hasAnalysis && timeUpdate.currentTime >= trimEnd) {
      player.pause();
      player.currentTime = trimStart;
      setCurrentTime(trimStart);
      return;
    }
    setCurrentTime(timeUpdate.currentTime);
  }, [timeUpdate, hasAnalysis, player, trimStart, trimEnd]);

  useEffect(() => {
    if (isAnalyzing && analysisProgress) {
      player.pause();
      player.currentTime = analysisProgress.currentTimeMs / 1000;
      setCurrentFrame(analysisProgress.frameResult);
    }
  }, [isAnalyzing, analysisProgress, player]);

  useEffect(() => {
    if (!frameResults?.length) {
      setCurrentFrame(null);
      return;
    }
    if (isAnalyzing) return;
    const closest = frameResults.reduce((best, frame) =>
      Math.abs(frame.timestampMs - currentTime * 1000) <
      Math.abs(best.timestampMs - currentTime * 1000)
        ? frame
        : best
    );
    setCurrentFrame(closest);
  }, [currentTime, frameResults, isAnalyzing]);

  useEffect(() => {
    if (!isAnalyzing && frameResults?.length) {
      player.currentTime = trimStart;
      setCurrentTime(trimStart);
      setCurrentFrame(frameResults[0]);
    }
  }, [isAnalyzing, frameResults, player, trimStart]);

  const displaySize = useMemo(() => {
    const maxWidth = Math.max(240, Math.min(windowWidth - 32, 420));
    const maxHeight = 460;
    const widthForHeight = maxHeight * videoAspectRatio;
    if (maxWidth / videoAspectRatio > maxHeight) {
      return { width: Math.round(widthForHeight), height: maxHeight };
    }
    return { width: Math.round(maxWidth), height: Math.round(maxWidth / videoAspectRatio) };
  }, [videoAspectRatio, windowWidth]);

  const changeStart = (delta: number) => {
    setTrimStart(Math.max(0, Math.min(trimEnd - 0.2, trimStart + delta)));
  };
  const changeEnd = (delta: number) => {
    setTrimEnd(Math.min(duration, Math.max(trimStart + 0.2, trimEnd + delta)));
  };
  const markStart = () => setTrimStart(Math.max(0, Math.min(currentTime, trimEnd - 0.2)));
  const markEnd = () => setTrimEnd(Math.min(duration, Math.max(currentTime, trimStart + 0.2)));

  const estimatedFrames = Math.floor(Math.max(0, trimEnd - trimStart) * selectedFps) + 1;

  return (
    <View style={styles.container}>
      <View style={[styles.videoWrapper, displaySize]}>
        <VideoView
          style={StyleSheet.absoluteFill}
          player={player}
          surfaceType="textureView"
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          allowsPictureInPicture
        />
        {currentFrame && (
          <PoseOverlay
            poses={currentFrame.poses}
            hands={currentFrame.hands}
            width={displaySize.width}
            height={displaySize.height}
          />
        )}
      </View>

      <Text style={styles.timeText}>
        {formatSeconds(currentTime)} / {formatSeconds(duration)}
      </Text>

      {isAnalyzing ? (
        <View style={styles.statusCard}>
          <Text style={styles.statusText}>
            {analysisProgress
              ? `Analisando quadro ${analysisProgress.currentFrame} de ${analysisProgress.totalFrames}`
              : 'Analisando vídeo…'}
          </Text>
        </View>
      ) : (
        <View style={styles.playbackRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => (isPlaying ? player.pause() : player.play())}
          >
            <Text style={styles.actionText}>{isPlaying ? 'Pausar' : 'Reproduzir'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => { segmentEndMsRef.current = null; player.seekBy(-0.5); }}>
            <Text style={styles.actionText}>−0,5 s</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => { segmentEndMsRef.current = null; player.seekBy(0.5); }}>
            <Text style={styles.actionText}>+0,5 s</Text>
          </TouchableOpacity>
        </View>
      )}

      {!hasAnalysis && !isAnalyzing && (
        <View style={styles.configPanel}>
          <Text style={styles.panelTitle}>Parâmetros de análise</Text>

          <Text style={styles.label}>Modelo de pose</Text>
          <View style={styles.optionsRow}>
            {(['lite', 'full', 'heavy'] as const).map((model) => (
              <TouchableOpacity
                key={model}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedPoseModel === model }}
                style={[styles.option, selectedPoseModel === model && styles.optionSelected]}
                onPress={() => setSelectedPoseModel(model)}
              >
                <Text style={styles.optionText}>
                  {model === 'lite' ? 'Lite · rápido' : model === 'full' ? 'Full · equilibrado' : 'Heavy · mais lento'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Escala do vídeo</Text>
          <View style={styles.optionsRow}>
            {PROCESSING_SCALES.map((option) => (
              <TouchableOpacity
                key={option.scale}
                style={[styles.option, selectedScale === option.scale && styles.optionSelected]}
                onPress={() => setSelectedScale(option.scale)}
              >
                <Text style={styles.optionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Amostragem</Text>
          <View style={styles.optionsRow}>
            {FPS_OPTIONS.map((fps) => (
              <TouchableOpacity
                key={fps}
                style={[styles.option, selectedFps === fps && styles.optionSelected]}
                onPress={() => setSelectedFps(fps)}
              >
                <Text style={styles.optionText}>{fps} FPS</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Detecção de mãos (mais lenta)</Text>
          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={[styles.option, !detectHands && styles.optionSelected]}
              onPress={() => setDetectHands(false)}
            >
              <Text style={styles.optionText}>Desativada · reps mais rápidas</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.option, detectHands && styles.optionSelected]}
              onPress={() => setDetectHands(true)}
            >
              <Text style={styles.optionText}>Ativada</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.trimRow}>
            <View style={styles.trimBlock}>
              <Text style={styles.label}>Início: {formatSeconds(trimStart)}</Text>
              <View style={styles.optionsRow}>
                <TouchableOpacity style={styles.option} onPress={() => changeStart(-0.5)}>
                  <Text style={styles.optionText}>−0,5 s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.option} onPress={() => changeStart(0.5)}>
                  <Text style={styles.optionText}>+0,5 s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.option} onPress={markStart}>
                  <Text style={styles.optionText}>Marcar atual</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.trimBlock}>
              <Text style={styles.label}>Fim: {formatSeconds(trimEnd)}</Text>
              <View style={styles.optionsRow}>
                <TouchableOpacity style={styles.option} onPress={() => changeEnd(-0.5)}>
                  <Text style={styles.optionText}>−0,5 s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.option} onPress={() => changeEnd(0.5)}>
                  <Text style={styles.optionText}>+0,5 s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.option} onPress={markEnd}>
                  <Text style={styles.optionText}>Marcar atual</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <Text style={styles.summaryText}>
            Trecho de {(trimEnd - trimStart).toFixed(1)} s · cerca de {estimatedFrames} quadros
          </Text>
          <TouchableOpacity
            disabled={!duration || trimEnd <= trimStart}
            style={[styles.startButton, (!duration || trimEnd <= trimStart) && styles.disabledButton]}
            onPress={() => {
              player.pause();
              onStartAnalysis?.({
                poseModel: selectedPoseModel,
                fps: selectedFps,
                scale: selectedScale,
                detectHands,
                startTime: trimStart,
                endTime: trimEnd,
              });
            }}
          >
            <Text style={styles.startText}>Analisar · {selectedScale === 'one-third' ? '1/3' : selectedScale === 'two-thirds' ? '2/3' : '1×'} · {selectedFps} FPS</Text>
          </TouchableOpacity>
        </View>
      )}

      {hasAnalysis && !isAnalyzing && (
        <TouchableOpacity style={styles.actionButton} onPress={onResetAnalysis}>
          <Text style={styles.actionText}>Reconfigurar trecho e análise</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 10, alignItems: 'center', justifyContent: 'center', width: '100%' },
  videoWrapper: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#000',
  },
  timeText: { color: '#C9D6BF', fontSize: 13, marginTop: 8 },
  playbackRow: { flexDirection: 'row', gap: 8, marginVertical: 12, flexWrap: 'wrap', justifyContent: 'center' },
  configPanel: {
    width: '100%',
    maxWidth: 520,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#18221B',
    gap: 10,
  },
  panelTitle: { color: '#EEF3E8', fontSize: 16, fontWeight: '700' },
  label: { color: '#C9D6BF', fontSize: 13, fontWeight: '600' },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 7, backgroundColor: '#2E3E30' },
  optionSelected: { backgroundColor: '#344A24' },
  optionText: { color: '#EEF3E8', fontSize: 12, fontWeight: '600' },
  trimRow: { gap: 12 },
  trimBlock: { gap: 6 },
  summaryText: { color: '#97A68F', fontSize: 12, marginTop: 2 },
  startButton: { backgroundColor: '#C5F566', padding: 12, borderRadius: 8, alignItems: 'center' },
  disabledButton: { opacity: 0.45 },
  startText: { color: '#19250D', fontWeight: '700' },
  actionButton: { backgroundColor: '#2E3E30', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 8 },
  actionText: { color: '#EEF3E8', fontSize: 13, fontWeight: '600' },
  statusCard: { padding: 12, marginTop: 12, borderRadius: 8, backgroundColor: '#18221B' },
  statusText: { color: '#C5F566', fontSize: 14, fontWeight: '600' },
});
