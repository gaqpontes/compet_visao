import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { FrameResult, ProcessingScale, VideoAnalysisProgress, PoseModel, DEFAULT_VIDEO_ANALYSIS_OPTIONS } from 'pose-tracker';
import { getEffectiveSampleRate } from '../../modules/pose-tracker/src/video-frame-helpers';
import PoseOverlay from './pose-overlay';
import type { VideoSeekRequest } from '../utils/video-playback';

export type AnalysisConfig = {
  benchWristTravel?: boolean;
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
  previewCanvasRef?: React.RefObject<HTMLCanvasElement | null>;
  onStartAnalysis?: (config: AnalysisConfig) => void;
  onResetAnalysis?: () => void;
  onFrameChange?: (frame: FrameResult) => void;
  seekRequest?: VideoSeekRequest | null;
};

const PROCESSING_SCALES: { scale: ProcessingScale; label: string }[] = [
  { scale: 'one-third', label: '1/3 (mais leve)' },
  { scale: 'two-thirds', label: '2/3 (equilibrado)' },
  { scale: 'original', label: '1× (original)' },
];

const formatScale = (scale: ProcessingScale) =>
  PROCESSING_SCALES.find((option) => option.scale === scale)?.label.split(' ')[0] ?? '1/3';

const FPS_OPTIONS = [6, 8, 10, 12, 15, 20, 24, 30];

export default function VideoScreenWeb({
  videoSource,
  allowBenchWristTravel = false,
  frameResults,
  isAnalyzing = false,
  analysisProgress,
  previewCanvasRef,
  onStartAnalysis,
  onResetAnalysis,
  onFrameChange,
  seekRequest,
}: VideoScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const segmentEndMsRef = useRef<number | null>(null);
  const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = previewCanvasRef || internalCanvasRef;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [currentFrame, setCurrentFrame] = useState<FrameResult | null>(null);

  // Parâmetros configuráveis pelo usuário no frontend
  const [benchWristTravel, setBenchWristTravel] = useState(false);
  const [selectedFps, setSelectedFps] = useState<number>(DEFAULT_VIDEO_ANALYSIS_OPTIONS.fps);
  const [selectedPoseModel, setSelectedPoseModel] = useState<PoseModel>(DEFAULT_VIDEO_ANALYSIS_OPTIONS.poseModel);
  const [selectedScale, setSelectedScale] = useState<ProcessingScale>(DEFAULT_VIDEO_ANALYSIS_OPTIONS.scale);
  const [detectHands, setDetectHands] = useState(DEFAULT_VIDEO_ANALYSIS_OPTIONS.detectHands);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);

  // Dimensões responsivas do container de exibição
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 360,
    height: 270,
  });

  const updateDimensions = (video: HTMLVideoElement) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const maxWidth = Math.min(typeof window !== 'undefined' ? (window.innerWidth >= 960 ? Math.min(window.innerWidth - 48, 1240) - 342 : window.innerWidth - (window.innerWidth < 600 ? 76 : 92)) : 360, 680);
    const maxHeight = 520;

    let w = maxWidth;
    let h = w * (vh / vw);

    if (h > maxHeight) {
      h = maxHeight;
      w = h * (vw / vh);
    }

    setDimensions({
      width: Math.round(w),
      height: Math.round(h),
    });
  };

  useEffect(() => {
    const resize = () => { if (videoRef.current) updateDimensions(videoRef.current); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Quando os metadados do vídeo carregam, inicializa duração e limites de trim
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.target as HTMLVideoElement;
    const durSec = el.duration || 0;
    const dMs = Math.round(durSec * 1000);
    setDurationMs(dMs);
    setTrimStart(0);
    setTrimEnd(Number(durSec.toFixed(1)));
    updateDimensions(el);
  };

  // Durante a análise: atualiza frame e progresso sem buscar o vídeo no DOM para não travar o decodificador
  useEffect(() => {
    if (isAnalyzing && analysisProgress) {
      // During analysis the video and landmarks are painted together on one canvas
      // by the synchronous Web pipeline, avoiding a delayed React/SVG overlay.
      setCurrentTimeMs(analysisProgress.currentTimeMs);
      if (analysisProgress.durationMs > 0) {
        setDurationMs(analysisProgress.durationMs);
      }
    }
  }, [isAnalyzing, analysisProgress]);

  useEffect(() => {
    if (!frameResults?.length) setCurrentFrame(null);
  }, [frameResults]);

  useEffect(() => {
    if (!isAnalyzing && currentFrame) onFrameChange?.(currentFrame);
  }, [currentFrame, isAnalyzing, onFrameChange]);

  useEffect(() => {
    if (!seekRequest || isAnalyzing || !frameResults?.length || !videoRef.current) return;
    const closest = frameResults.reduce((best, frame) =>
      Math.abs(frame.timestampMs - seekRequest.timestampMs) < Math.abs(best.timestampMs - seekRequest.timestampMs) ? frame : best);
    videoRef.current.pause();
    segmentEndMsRef.current = seekRequest.endTimestampMs ?? null;
    videoRef.current.currentTime = closest.timestampMs / 1000;
    setCurrentTimeMs(closest.timestampMs);
    setCurrentFrame(closest);
    setIsPlaying(false);
    if (seekRequest.endTimestampMs !== undefined) {
      void videoRef.current.play().then(() => {
        if (!videoRef.current?.paused) setIsPlaying(true);
      }).catch(() => setIsPlaying(false));
    }
  }, [seekRequest, frameResults, isAnalyzing]);

  // Ao terminar, mantém o vídeo no último quadro analisado em vez de saltar para trás.
  useEffect(() => {
    if (!isAnalyzing && videoRef.current && frameResults && frameResults.length > 0) {
      const finalFrame = frameResults[frameResults.length - 1];
      videoRef.current.currentTime = finalFrame.timestampMs / 1000;
      setCurrentTimeMs(finalFrame.timestampMs);
      setIsPlaying(false);
      setCurrentFrame(finalFrame);
    }
  }, [isAnalyzing, frameResults]);

  // Sincroniza o overlay somente durante a reprodução para não consumir CPU quando pausado.
  useEffect(() => {
    if (isAnalyzing || !isPlaying || !frameResults || frameResults.length === 0) return;

    let animId: number;
    const updateOverlay = () => {
      const video = videoRef.current;
      if (!video || video.paused) return;

      const segmentEndMs = segmentEndMsRef.current;
      if (segmentEndMs !== null && video.currentTime * 1000 >= segmentEndMs) {
        video.pause();
        video.currentTime = segmentEndMs / 1000;
        setCurrentTimeMs(segmentEndMs);
        const closest = frameResults.reduce((best, frame) => Math.abs(frame.timestampMs - segmentEndMs) < Math.abs(best.timestampMs - segmentEndMs) ? frame : best);
        setCurrentFrame(closest);
        segmentEndMsRef.current = null;
        setIsPlaying(false);
        return;
      }

      if (video.currentTime >= trimEnd) {
        video.pause();
        video.currentTime = trimStart;
        setCurrentTimeMs(Math.round(trimStart * 1000));
        setCurrentFrame(frameResults[0]);
        setIsPlaying(false);
        return;
      }

      {
        const timeMs = Math.round(video.currentTime * 1000);
        setCurrentTimeMs(timeMs);

        // Encontra o quadro correspondente mais próximo
        let closest = frameResults[0];
        let minDiff = Math.abs(closest.timestampMs - timeMs);

        for (let i = 1; i < frameResults.length; i++) {
          const diff = Math.abs(frameResults[i].timestampMs - timeMs);
          if (diff < minDiff) {
            minDiff = diff;
            closest = frameResults[i];
          } else if (diff > minDiff) {
            break;
          }
        }
        setCurrentFrame(closest);
      }
      animId = requestAnimationFrame(updateOverlay);
    };

    animId = requestAnimationFrame(updateOverlay);
    return () => cancelAnimationFrame(animId);
  }, [isAnalyzing, isPlaying, frameResults, trimStart, trimEnd]);

  const togglePlay = () => {
    if (!videoRef.current || isAnalyzing) return;
    if (videoRef.current.paused) {
      void videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current || isAnalyzing) return;
    segmentEndMsRef.current = null;
    const requestedTime = Number(e.target.value);
    const targetTime = hasAnalysis
      ? Math.max(trimStart, Math.min(trimEnd, requestedTime))
      : requestedTime;
    videoRef.current.currentTime = targetTime;
    const timeMs = Math.round(targetTime * 1000);
    setCurrentTimeMs(timeMs);

    if (frameResults && frameResults.length > 0) {
      let closest = frameResults[0];
      let minDiff = Math.abs(closest.timestampMs - timeMs);
      for (let i = 1; i < frameResults.length; i++) {
        const diff = Math.abs(frameResults[i].timestampMs - timeMs);
        if (diff < minDiff) {
          minDiff = diff;
          closest = frameResults[i];
        }
      }
      setCurrentFrame(closest);
    }
  };

  const stepFrame = (direction: 'next' | 'prev') => {
    if (!videoRef.current || isAnalyzing || !frameResults || frameResults.length === 0) return;
    videoRef.current.pause();
    segmentEndMsRef.current = null;
    setIsPlaying(false);

    const currentIndex = frameResults.reduce(
      (bestIndex, frame, index) =>
        Math.abs(frame.timestampMs - currentTimeMs) <
        Math.abs(frameResults[bestIndex].timestampMs - currentTimeMs)
          ? index
          : bestIndex,
      0
    );
    const targetIndex = direction === 'next'
      ? Math.min(frameResults.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);

    const target = frameResults[targetIndex];
    if (target) {
      videoRef.current.currentTime = target.timestampMs / 1000;
      setCurrentTimeMs(target.timestampMs);
      setCurrentFrame(target);
    }
  };

  const restartVideo = () => {
    if (!videoRef.current || isAnalyzing) return;
    segmentEndMsRef.current = null;
    videoRef.current.currentTime = trimStart;
    setCurrentTimeMs(Math.round(trimStart * 1000));
    if (frameResults && frameResults.length > 0) {
      setCurrentFrame(frameResults[0]);
    }
  };

  const formatSeconds = (sec: number) => {
    const s = Math.max(0, sec);
    const mins = Math.floor(s / 60);
    const secs = (s % 60).toFixed(1);
    return `${mins.toString().padStart(2, '0')}:${Number(secs) < 10 ? '0' : ''}${secs}`;
  };

  // Funções de Trim Temporal
  const setStartToCurrent = () => {
    const cur = currentTimeMs / 1000;
    const valid = Math.min(cur, Math.max(0, trimEnd - 0.2));
    setTrimStart(Number(valid.toFixed(1)));
  };

  const setEndToCurrent = () => {
    const cur = currentTimeMs / 1000;
    const maxDur = durationMs / 1000;
    const valid = Math.max(cur, Math.min(maxDur, trimStart + 0.2));
    setTrimEnd(Number(valid.toFixed(1)));
  };

  const adjustStart = (delta: number) => {
    const val = Math.max(0, Math.min(trimEnd - 0.2, trimStart + delta));
    setTrimStart(Number(val.toFixed(1)));
  };

  const adjustEnd = (delta: number) => {
    const maxDur = durationMs / 1000 || 60;
    const val = Math.min(maxDur, Math.max(trimStart + 0.2, trimEnd + delta));
    setTrimEnd(Number(val.toFixed(1)));
  };

  const handleStartAnalysisClick = () => {
    videoRef.current?.pause();
    setIsPlaying(false);
    if (onStartAnalysis) {
      onStartAnalysis({
        benchWristTravel: allowBenchWristTravel && benchWristTravel,
        poseModel: selectedPoseModel,
        fps: selectedFps,
        scale: selectedScale,
        detectHands,
        startTime: trimStart,
        endTime: trimEnd,
      });
    }
  };

  const hasAnalysis = Boolean(frameResults && frameResults.length > 0);
  const selectedDuration = Math.max(0, trimEnd - trimStart);
  const estimatedFrames = Math.floor(selectedDuration * selectedFps) + 1;
  const effectiveFps = getEffectiveSampleRate(frameResults ?? []);

  return (
    <View style={styles.container}>
      {/* Container do Vídeo / Canvas de Preview */}
      <View
        style={[
          styles.videoWrapper,
          {
            width: dimensions.width,
            height: dimensions.height,
          },
        ]}
      >
        {/* Vídeo HTML5 (visível quando não está analisando) */}
        <video
          ref={videoRef}
          src={videoSource}
          playsInline
          muted
          style={{
            width: dimensions.width,
            height: dimensions.height,
            display: isAnalyzing ? 'none' : 'block',
            backgroundColor: '#000',
            objectFit: 'contain',
          }}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={() => {
            if (videoRef.current && !hasAnalysis) {
              setCurrentTimeMs(Math.round(videoRef.current.currentTime * 1000));
            }
          }}
          onEnded={() => setIsPlaying(false)}
        />

        {/* Canvas de preview na proporção original; a análise usa uma cópia reduzida. */}
        <canvas
          ref={activeCanvasRef as any}
          width={dimensions.width}
          height={dimensions.height}
          style={{
            width: dimensions.width,
            height: dimensions.height,
            display: isAnalyzing ? 'block' : 'none',
            backgroundColor: '#000',
          }}
        />

        {/* Overlay dos Pontos Anatômicos e Esqueleto */}
        {!isAnalyzing && currentFrame && (
          <PoseOverlay
            poses={currentFrame.poses}
            hands={currentFrame.hands}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        {/* Badges de Status Superior */}
        {isAnalyzing ? (
          <View style={styles.liveBadge}>
            <View style={styles.livePulseDot} />
            <Text style={styles.liveBadgeText}>
              PROCESSANDO {formatScale(selectedScale)} • {selectedFps} FPS
            </Text>
          </View>
        ) : hasAnalysis ? (
          <View style={styles.readyBadge}>
            <Text style={styles.readyBadgeText}>
              {frameResults?.length} QUADROS · {effectiveFps?.toFixed(1) ?? '—'} FPS EFETIVOS
            </Text>
          </View>
        ) : (
          <View style={styles.configBadge}>
            <Text style={styles.configBadgeText}>SELECIONE O INTERVALO</Text>
          </View>
        )}
      </View>

      {/* Barra de Progresso / Linha do Tempo */}
      <View style={[styles.scrubberContainer, { width: dimensions.width }]}>
        {isAnalyzing && analysisProgress ? (
          <View style={styles.progressBarWrapper}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.round(analysisProgress.progress * 100)}%` },
              ]}
            />
          </View>
        ) : (
          <input
            type="range"
            min={hasAnalysis ? trimStart : 0}
            max={hasAnalysis ? trimEnd : durationMs / 1000 || 0}
            step={1 / selectedFps}
            value={currentTimeMs / 1000}
            onChange={handleSeek}
            style={{
              width: '100%',
              cursor: 'pointer',
              accentColor: '#C5F566',
              height: '6px',
            }}
          />
        )}
      </View>

      {/* Informações de Tempo e Frame */}
      <View style={[styles.infoRow, { width: dimensions.width }]}>
        {isAnalyzing && analysisProgress ? (
          <>
            <Text style={styles.infoTextPrimary}>
              Quadro {analysisProgress.currentFrame} de {analysisProgress.totalFrames}
            </Text>
            <Text style={styles.infoTextSecondary}>
              {Math.round(analysisProgress.progress * 100)}% concluído
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.infoTextPrimary}>
              Tempo Atual: {formatSeconds(currentTimeMs / 1000)} / {formatSeconds(durationMs / 1000)}
            </Text>
            <Text style={styles.infoTextSecondary}>
              {hasAnalysis ? `${frameResults?.length} quadros` : 'Aguardando Análise'}
            </Text>
          </>
        )}
      </View>
      {(hasAnalysis || isAnalyzing) && allowBenchWristTravel && benchWristTravel && <Text style={[styles.infoTextSecondary, { width: dimensions.width }]}>Supino: contagem pela trajetória do punho. O ângulo exibido é uma leitura independente.</Text>}
      {isAnalyzing && analysisProgress?.performance && (
        <Text style={[styles.infoTextSecondary, styles.performanceText, { width: dimensions.width }]}>
          Entrada {analysisProgress.performance.sourceWidth}×{analysisProgress.performance.sourceHeight}
          {' → '}{analysisProgress.performance.inputWidth}×{analysisProgress.performance.inputHeight}
          {' · espera quadro '}{analysisProgress.performance.frameWaitMs.toFixed(1)}ms
          {' · pose '}{analysisProgress.performance.poseMs.toFixed(1)}ms
          {detectHands ? ` · mãos ${analysisProgress.performance.handMs.toFixed(1)}ms` : ''}
          {' · total '}{analysisProgress.performance.totalMs.toFixed(1)}ms
        </Text>
      )}

      {/* PAINEL DE CONFIGURAÇÃO PRÉ-ANÁLISE (Escolha de Resolução, FPS e Início/Fim) */}
      {!hasAnalysis && !isAnalyzing && (
        <View style={[styles.configPanel, { width: dimensions.width }]}>
          <Text style={styles.configTitle}>Configurar análise</Text>

          <View style={styles.paramGroup}>
            <Text style={styles.paramLabel}>Modelo de pose:</Text>
            <View style={styles.optionsRow}>
              {(['lite', 'full', 'heavy'] as const).map((model) => (
                <TouchableOpacity key={model} style={[styles.pillButton, selectedPoseModel === model && styles.pillButtonActive]} onPress={() => setSelectedPoseModel(model)}>
                  <Text style={[styles.pillText, selectedPoseModel === model && styles.pillTextActive]}>
                    {model === 'lite' ? 'Lite · rápido' : model === 'full' ? 'Full · equilibrado' : 'Heavy · mais lento'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {allowBenchWristTravel && <View style={styles.paramGroup}>
            <Text style={styles.paramLabel}>Método de contagem:</Text>
            <View style={styles.optionsRow}>
              <TouchableOpacity accessibilityRole="button" style={[styles.pillButton, !benchWristTravel && styles.pillButtonActive]} onPress={() => setBenchWristTravel(false)}><Text style={styles.pillText}>Ângulo da articulação</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.pillButton, benchWristTravel && styles.pillButtonActive]} onPress={() => setBenchWristTravel(true)}><Text style={styles.pillText}>Supino · trajetória do punho</Text></TouchableOpacity>
            </View>
            <Text style={styles.infoTextSecondary}>Trajetória: alternativa para supino com cotovelo encoberto. Marque somente a série; ciclos de deslocamento não certificam amplitude articular.</Text>
          </View>}

          {/* Seleção de Resolução */}
          <View style={styles.paramGroup}>
            <Text style={styles.paramLabel}>Escala da imagem:</Text>
            <View style={styles.optionsRow}>
              {PROCESSING_SCALES.map((option) => {
                const isActive = selectedScale === option.scale;
                return (
                  <TouchableOpacity
                    key={option.scale}
                    style={[styles.pillButton, isActive && styles.pillButtonActive]}
                    onPress={() => setSelectedScale(option.scale)}
                  >
                    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Seleção de FPS */}
          <View style={styles.paramGroup}>
            <Text style={styles.paramLabel}>Taxa de Amostragem (FPS):</Text>
            <View style={styles.optionsRow}>
              {FPS_OPTIONS.map((f) => {
                const isActive = selectedFps === f;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[styles.pillButtonSmall, isActive && styles.pillButtonActive]}
                    onPress={() => setSelectedFps(f)}
                  >
                    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                      {f} FPS
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.paramGroup}>
            <Text style={styles.paramLabel}>Detecção de mãos (mais lenta):</Text>
            <View style={styles.optionsRow}>
              <TouchableOpacity
                style={[styles.pillButton, !detectHands && styles.pillButtonActive]}
                onPress={() => setDetectHands(false)}
              >
                <Text style={[styles.pillText, !detectHands && styles.pillTextActive]}>
                  Desativada · recomendada para reps
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pillButton, detectHands && styles.pillButtonActive]}
                onPress={() => setDetectHands(true)}
              >
                <Text style={[styles.pillText, detectHands && styles.pillTextActive]}>
                  Ativada
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Definição de Início e Fim (Trim Temporal) */}
          <View style={styles.paramGroup}>
            <Text style={styles.paramLabel}>Intervalo do Exercício (Início e Fim):</Text>

            {/* Início */}
            <View style={styles.trimRow}>
              <View style={styles.trimLabelContainer}>
                <Text style={styles.trimLabel}>🚩 Início:</Text>
                <Text style={styles.trimValue}>{formatSeconds(trimStart)}</Text>
              </View>
              <View style={styles.trimActions}>
                <TouchableOpacity style={styles.trimStepBtn} onPress={() => adjustStart(-0.5)}>
                  <Text style={styles.trimStepText}>-0.5s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.trimStepBtn} onPress={() => adjustStart(0.5)}>
                  <Text style={styles.trimStepText}>+0.5s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.trimSetBtn} onPress={setStartToCurrent}>
                  <Text style={styles.trimSetText}>Ponto Atual</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Fim */}
            <View style={styles.trimRow}>
              <View style={styles.trimLabelContainer}>
                <Text style={styles.trimLabel}>🏁 Fim:</Text>
                <Text style={styles.trimValue}>{formatSeconds(trimEnd)}</Text>
              </View>
              <View style={styles.trimActions}>
                <TouchableOpacity style={styles.trimStepBtn} onPress={() => adjustEnd(-0.5)}>
                  <Text style={styles.trimStepText}>-0.5s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.trimStepBtn} onPress={() => adjustEnd(0.5)}>
                  <Text style={styles.trimStepText}>+0.5s</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.trimSetBtn} onPress={setEndToCurrent}>
                  <Text style={styles.trimSetText}>Ponto Atual</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Resumo do Trecho Selecionado */}
            <View style={styles.trimSummaryCard}>
              <Text style={styles.trimSummaryText}>
                Duração: {selectedDuration.toFixed(1)}s • Estimativa: ~{estimatedFrames} quadros
              </Text>
            </View>
          </View>

          {/* Botão Principal de Início da Análise */}
          <TouchableOpacity
            style={styles.startAnalysisButton}
            onPress={handleStartAnalysisClick}
          >
            <Text style={styles.startAnalysisText}>
              ⚡ Analisar Vídeo ({formatScale(selectedScale)} • {selectedFps} FPS)
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* CONTROLES DE REPRODUÇÃO PÓS-ANÁLISE */}
      {hasAnalysis && !isAnalyzing && (
        <View style={styles.postAnalysisContainer}>
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.actionButton} onPress={restartVideo}>
              <Text style={styles.actionButtonText}>⏮ Início</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.stepButton} onPress={() => stepFrame('prev')}>
              <Text style={styles.buttonText}>◀ Quadro</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.playButton} onPress={togglePlay}>
              <Text style={styles.playButtonText}>{isPlaying ? '⏸ Pausar' : '▶ Reproduzir'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.stepButton} onPress={() => stepFrame('next')}>
              <Text style={styles.buttonText}>Quadro ▶</Text>
            </TouchableOpacity>
          </View>

          {onResetAnalysis && (
            <TouchableOpacity style={styles.reconfigButton} onPress={onResetAnalysis}>
              <Text style={styles.reconfigButtonText}>⚙️ Reconfigurar Intervalo / Parâmetros</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: '100%',
  },
  videoWrapper: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1.5,
    borderColor: '#2E3E30',
    boxShadow: '0 12px 28px -6px rgba(0, 0, 0, 0.6)',
  },
  liveBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: '#C5F566',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C5F566',
  },
  liveBadgeText: {
    color: '#C5F566',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  readyBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: '#22C55E',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  readyBadgeText: {
    color: '#22C55E',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  configBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: '#2E3E30',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  configBadgeText: {
    color: '#97A68F',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scrubberContainer: {
    marginTop: 14,
  },
  progressBarWrapper: {
    height: 8,
    backgroundColor: '#18221B',
    borderRadius: 4,
    overflow: 'hidden',
    width: '100%',
    borderWidth: 1,
    borderColor: '#2E3E30',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#C5F566',
    borderRadius: 4,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  infoTextPrimary: {
    color: '#EEF3E8',
    fontSize: 12,
    fontWeight: '600',
  },
  infoTextSecondary: {
    color: '#84927D',
    fontSize: 12,
  },
  performanceText: {
    fontSize: 10,
    marginTop: 5,
    textAlign: 'center',
  },
  configPanel: {
    marginTop: 16,
    backgroundColor: '#18221B',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2E3E30',
  },
  configTitle: {
    color: '#EEF3E8',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  paramGroup: {
    marginBottom: 14,
  },
  paramLabel: {
    color: '#97A68F',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pillButton: {
    backgroundColor: '#0B100F',
    borderWidth: 1,
    borderColor: '#2E3E30',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pillButtonSmall: {
    backgroundColor: '#0B100F',
    borderWidth: 1,
    borderColor: '#2E3E30',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  pillButtonActive: {
    backgroundColor: '#C5F566',
    borderColor: '#C5F566',
  },
  pillText: {
    color: '#97A68F',
    fontSize: 11,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#19250D',
    fontWeight: '700',
  },
  trimRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0B100F',
    padding: 8,
    borderRadius: 8,
    marginBottom: 6,
  },
  trimLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trimLabel: {
    color: '#97A68F',
    fontSize: 12,
    fontWeight: '600',
  },
  trimValue: {
    color: '#C5F566',
    fontSize: 13,
    fontWeight: 'bold',
  },
  trimActions: {
    flexDirection: 'row',
    gap: 4,
  },
  trimStepBtn: {
    backgroundColor: '#18221B',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2E3E30',
  },
  trimStepText: {
    color: '#C9D6BF',
    fontSize: 10,
    fontWeight: '600',
  },
  trimSetBtn: {
    backgroundColor: '#C5F566',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  trimSetText: {
    color: '#19250D',
    fontSize: 10,
    fontWeight: '700',
  },
  trimSummaryCard: {
    backgroundColor: 'rgba(197, 245, 102, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(197, 245, 102, 0.2)',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
    alignItems: 'center',
  },
  trimSummaryText: {
    color: '#C5F566',
    fontSize: 11,
    fontWeight: '600',
  },
  startAnalysisButton: {
    backgroundColor: '#C5F566',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  startAnalysisText: {
    color: '#19250D',
    fontWeight: '700',
    fontSize: 13,
  },
  postAnalysisContainer: {
    width: '100%',
    alignItems: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  playButton: {
    backgroundColor: '#C5F566',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  playButtonText: {
    color: '#19250D',
    fontWeight: '700',
    fontSize: 14,
  },
  stepButton: {
    backgroundColor: '#18221B',
    borderWidth: 1,
    borderColor: '#2E3E30',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: {
    color: '#EEF3E8',
    fontSize: 12,
    fontWeight: '600',
  },
  actionButton: {
    backgroundColor: '#18221B',
    borderWidth: 1,
    borderColor: '#2E3E30',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionButtonText: {
    color: '#97A68F',
    fontSize: 12,
    fontWeight: '600',
  },
  reconfigButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#18221B',
    borderWidth: 1,
    borderColor: '#2E3E30',
  },
  reconfigButtonText: {
    color: '#97A68F',
    fontSize: 12,
    fontWeight: '600',
  },
});
