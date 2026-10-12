import React, { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { FrameResult } from 'pose-tracker';
import type { CounterSnapshot } from '../utils/counter-timeline';
import type { SignalState } from '../utils/exercise-feedback';
import { findTimelineIndex, getAngleSegments } from '../utils/analysis-plot';
import type { CompletedRepetition } from '../utils/repetition-counter';
import type { RepetitionFeedback, REPETITION_REFERENCES } from '../utils/repetition-feedback';

const COLORS: Record<SignalState, string> = { yes: '#22C55E', no: '#EF4444', unknown: '#FBBF24' };
const BANDS = [{ key: 'pose', label: 'Pose' }, { key: 'posture', label: 'Posição' }, { key: 'flexed', label: 'Flexão' }, { key: 'extended', label: 'Extensão' }] as const;

export default function AnalysisTimelineGraph({ frames, snapshots, repetitions, feedback, reference, tolerancePercent, selectedTimestampMs, onSelectTimestamp, onPlayRepetition }: {
  frames: FrameResult[]; snapshots: Map<number, CounterSnapshot>; selectedTimestampMs: number;
  repetitions: CompletedRepetition[];
  feedback: RepetitionFeedback[];
  reference: (typeof REPETITION_REFERENCES)[keyof typeof REPETITION_REFERENCES];
  tolerancePercent: number;
  onSelectTimestamp: (timestampMs: number) => void;
  onPlayRepetition: (repetition: CompletedRepetition) => void;
}) {
  const [width, setWidth] = useState(360);
  const chartRef = useRef<View>(null);
  const chartLeftRef = useRef(0);
  const left = 62, right = 12, top = 12, plotHeight = 126, bandTop = 172, bandHeight = 14, bandGap = 8;
  const plotWidth = Math.max(1, width - left - right);
  const start = frames[0]?.timestampMs ?? 0, end = frames[frames.length - 1]?.timestampMs ?? start;
  const span = Math.max(1, end - start);
  const x = (time: number) => left + (time - start) / span * plotWidth;
  const y = (angle: number) => top + (180 - angle) / 180 * plotHeight;
  const segments = useMemo(() => getAngleSegments(frames, snapshots), [frames, snapshots]);
  const selectedIndex = findTimelineIndex(frames, selectedTimestampMs);
  const selectedFrame = frames[selectedIndex];
  const selected = selectedFrame ? snapshots.get(selectedFrame.timestampMs) : undefined;
  const bands = useMemo(() => BANDS.map(({ key, label }) => {
    const runs: { start: number; end: number; state: SignalState }[] = [];
    frames.forEach((frame, i) => {
      const snapshot = snapshots.get(frame.timestampMs);
      const state = key === 'posture' ? snapshot?.posture.state ?? 'unknown' : snapshot?.[key] ?? 'unknown';
      const until = frames[i + 1]?.timestampMs ?? frame.timestampMs;
      const previous = runs[runs.length - 1];
      if (previous?.state === state) previous.end = until;
      else runs.push({ start: frame.timestampMs, end: until, state });
    });
    return { key, label, runs };
  }), [frames, snapshots]);
  if (!frames.length) return null;
  const selectAt = (event: GestureResponderEvent) => {
    event.preventDefault();
    // locationX may change its origin when a pointer crosses SVG children on Web.
    const localX = event.nativeEvent.pageX - chartLeftRef.current;
    const time = start + Math.max(0, Math.min(1, (localX - left) / plotWidth)) * span;
    const index = findTimelineIndex(frames, time);
    if (index >= 0 && frames[index].timestampMs !== selectedTimestampMs) onSelectTimestamp(frames[index].timestampMs);
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Ângulo e status ao longo do tempo</Text>
      <Text style={styles.hint}>Toque ou arraste para ver a posição no vídeo.</Text>
      <Text style={styles.detail}>{repetitions.length} repetições detectadas · início ○ · fim ●</Text>
      <View
        ref={chartRef} style={styles.chart}
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
          chartRef.current?.measureInWindow((chartLeft) => { chartLeftRef.current = chartLeft; });
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={selectAt} onResponderMove={selectAt} onResponderRelease={selectAt}
        onResponderTerminationRequest={() => false}
        accessible accessibilityRole="adjustable"
        accessibilityLabel="Linha do tempo da análise"
        accessibilityValue={{ min: start / 1000, max: end / 1000, now: (selectedFrame?.timestampMs ?? start) / 1000 }}
        aria-valuemin={start / 1000} aria-valuemax={end / 1000} aria-valuenow={(selectedFrame?.timestampMs ?? start) / 1000}
        aria-valuetext={`${((selectedFrame?.timestampMs ?? start) / 1000).toFixed(2)} segundos`}
        tabIndex={0}
        {...(Platform.OS === 'web' ? { onKeyDown: (event: React.KeyboardEvent) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? frames.length - 1 : Math.max(0, Math.min(frames.length - 1, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)));
          onSelectTimestamp(frames[next].timestampMs);
        } } : {})}
        accessibilityActions={[{ name: 'increment', label: 'Próximo quadro' }, { name: 'decrement', label: 'Quadro anterior' }]}
        onAccessibilityAction={(event) => {
          const next = Math.max(0, Math.min(frames.length - 1, selectedIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1)));
          onSelectTimestamp(frames[next].timestampMs);
        }}
      >
        <Svg width={width} height={270} pointerEvents="none">
          {[0, 60, 120, 180].map((angle) => (
            <React.Fragment key={angle}>
              <Line x1={left} y1={y(angle)} x2={width - right} y2={y(angle)} stroke="#2E3E30" />
              <SvgText x={left - 8} y={y(angle) + 4} textAnchor="end" fontSize={10} fill="#97A68F">{angle}°</SvgText>
            </React.Fragment>
          ))}
          {segments.map((segment, i) => segment.length === 1 ? (
            <Circle key={i} cx={x(segment[0].timestampMs)} cy={y(segment[0].angle)} r={2} fill="#C5F566" />
          ) : (
            <Polyline key={i} points={segment.map((p) => `${x(p.timestampMs)},${y(p.angle)}`).join(' ')} fill="none" stroke="#C5F566" strokeWidth={2} />
          ))}
          {repetitions.map((rep) => (
            <React.Fragment key={rep.index}>
              <Rect x={x(rep.startTimestampMs)} y={top} width={Math.max(1, x(rep.endTimestampMs) - x(rep.startTimestampMs))} height={plotHeight} fill="#A78BFA" opacity={0.08} />
              <Line x1={x(rep.startTimestampMs)} y1={top} x2={x(rep.startTimestampMs)} y2={top + plotHeight} stroke="#A78BFA" strokeDasharray="3 3" />
              <Line x1={x(rep.endTimestampMs)} y1={top} x2={x(rep.endTimestampMs)} y2={top + plotHeight} stroke="#A78BFA" strokeDasharray="3 3" />
              <Circle cx={x(rep.startTimestampMs)} cy={y(snapshots.get(rep.startTimestampMs)?.angle ?? 0)} r={4} fill="#18221B" stroke="#C4B5FD" strokeWidth={2} />
              <Circle cx={x(rep.endTimestampMs)} cy={y(snapshots.get(rep.endTimestampMs)?.angle ?? 0)} r={4} fill="#C4B5FD" />
              <SvgText x={x((rep.startTimestampMs + rep.endTimestampMs) / 2)} y={top + 11} textAnchor="middle" fontSize={10} fill="#DDD6FE">R{rep.index}</SvgText>
            </React.Fragment>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <SvgText key={fraction} x={left + plotWidth * fraction} y={155} textAnchor="middle" fontSize={10} fill="#97A68F">
              {((start + span * fraction) / 1000).toFixed(1)}s
            </SvgText>
          ))}
          {bands.map((band, i) => (
            <React.Fragment key={band.key}>
              <SvgText x={left - 8} y={bandTop + i * (bandHeight + bandGap) + 11} textAnchor="end" fontSize={10} fill="#C9D6BF">{band.label}</SvgText>
              {band.runs.map((run, j) => (
                <Rect key={j} x={x(run.start)} y={bandTop + i * (bandHeight + bandGap)} width={Math.max(1, x(run.end) - x(run.start))} height={bandHeight} fill={COLORS[run.state]} opacity={0.85} />
              ))}
            </React.Fragment>
          ))}
          {selectedFrame && <Line x1={x(selectedFrame.timestampMs)} y1={top} x2={x(selectedFrame.timestampMs)} y2={254} stroke="#EEF3E8" strokeWidth={1.5} />}
          {selected && selected.quality !== 'unavailable' && selectedFrame && <Circle cx={x(selectedFrame.timestampMs)} cy={y(selected.angle)} r={4} fill="#EEF3E8" />}
        </Svg>
      </View>
      {selected && selectedFrame && (
        <View style={styles.details}>
          <Text style={styles.detail}>{(selectedFrame.timestampMs / 1000).toFixed(2)} s · {selected.quality === 'unavailable' ? 'Sem leitura angular' : `${selected.quality === 'estimated' ? '≈' : ''}${selected.angle}°`} · {selected.reps} reps</Text>
          <Text style={styles.detail}>{selected.posture.label} · {selected.quality !== 'observed' ? 'Movimento indeterminado' : selected.flexed === 'yes' ? 'Flexionado' : selected.extended === 'yes' ? 'Estendido' : 'Entre extremos'}</Text>
        </View>
      )}
      <Text style={styles.hint}>Verde: sim · vermelho: não · amarelo: indeterminado</Text>
      <View style={styles.reference}>
        <Text style={styles.title}>Feedback por repetição · amplitude angular</Text>
        <Text style={styles.detail}>{reference.description}</Text>
        <Text style={styles.hint}>{reference.limitation}</Text>
        <Text selectable style={styles.hint}>{reference.author} · DOI: {reference.doi}</Text>
        <Text style={styles.hint}>Tolerância atual: {tolerancePercent}% da faixa de referência. Essa margem é um ajuste do app, sem validação científica. Os limites de avaliação podem diferir dos limites de contagem.</Text>
        <Text style={styles.hint}>Ângulos estimados pelo vídeo. Adequada significa que atendeu ao critério angular; não certifica toda a técnica ou a segurança do exercício.</Text>
        {repetitions.length === 0 && <Text style={styles.detail}>Nenhuma repetição confirmada para avaliar individualmente.</Text>}
      </View>
      {repetitions.map((rep) => (
        <View key={rep.index} style={styles.repetitionCard}>
        <View style={styles.repetitionRow}>
          <TouchableOpacity style={styles.repetitionButton} accessibilityRole="button" accessibilityLabel={`Reproduzir repetição ${rep.index}`} onPress={() => onPlayRepetition(rep)}>
            <Text style={styles.detail}>▶ Rep {rep.index} · {((rep.endTimestampMs - rep.startTimestampMs) / 1000).toFixed(2)} s</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.endpointButton} accessibilityRole="button" accessibilityLabel={`Início da repetição ${rep.index}`} onPress={() => onSelectTimestamp(rep.startTimestampMs)}>
            <Text style={styles.detail}>○ {(rep.startTimestampMs / 1000).toFixed(2)} s</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.endpointButton} accessibilityRole="button" accessibilityLabel={`Fim da repetição ${rep.index}`} onPress={() => onSelectTimestamp(rep.endTimestampMs)}>
            <Text style={styles.detail}>● {(rep.endTimestampMs / 1000).toFixed(2)} s</Text>
          </TouchableOpacity>
        </View>
        {feedback.filter(item => item.index === rep.index).map(item => (
          <View key={item.index} style={styles.details}>
            <Text style={[styles.title, { color: item.status === 'adequate' ? '#86EFAC' : item.status === 'inadequate' ? '#FCA5A5' : '#FCD34D' }]}>{item.label}</Text>
            {item.reasons.map((reason, index) => <Text key={index} style={styles.detail}>{reason}</Text>)}
            {item.limits && <Text style={styles.hint}>Critério atual: descida ≤ {item.limits.flexion.toFixed(1)}° · retorno ≥ {item.limits.extension.toFixed(1)}°</Text>}
          </View>
        ))}
        </View>
      ))}
      {repetitions.length > 0 && <Text style={styles.hint}>▶ reproduz somente a repetição · ○ e ● abrem os extremos detectados.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  repetitionCard: { gap: 8, padding: 10, borderWidth: 1, borderColor: '#2E3E30', borderRadius: 8 },
  reference: { gap: 6, paddingVertical: 10 },
  chart: { width: '100%', userSelect: 'none' },
  repetitionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  repetitionButton: { padding: 8, borderRadius: 6, backgroundColor: '#5B21B6' },
  endpointButton: { padding: 8, borderRadius: 6, backgroundColor: '#2E3E30' },
  panel: { width: '100%', maxWidth: 720, borderRadius: 12, borderWidth: 1, borderColor: '#2E3E30', backgroundColor: '#18221B', padding: 12, marginTop: 16, gap: 8 },
  title: { color: '#EEF3E8', fontSize: 14, fontWeight: '700' },
  hint: { color: '#97A68F', fontSize: 11 },
  details: { gap: 4 }, detail: { color: '#E2E8F0', fontSize: 12 },
});
