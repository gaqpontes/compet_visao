import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CounterSnapshot } from '../utils/counter-timeline';
import type { SignalState } from '../utils/exercise-feedback';

const COLORS: Record<SignalState, string> = { yes: '#22C55E', no: '#EF4444', unknown: '#FBBF24' };
const ANSWERS: Record<SignalState, string> = { yes: 'Sim', no: 'Não', unknown: 'Indeterminado' };

export default function ExerciseSignals({ stats }: { stats: CounterSnapshot }) {
  const signals: { title: string; state: SignalState; detail?: string }[] = [
    { title: 'Posição para o exercício', state: stats.posture.state, detail: stats.posture.label },
    { title: 'Pose detectada', state: stats.pose },
    { title: 'Flexionado', state: stats.flexed },
    { title: 'Estendido', state: stats.extended },
  ];
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>LEITURA DO MOVIMENTO</Text>
      {signals.map(({ title, state, detail }) => (
        <View key={title} style={styles.row} accessible accessibilityLabel={`${title}: ${detail ?? ANSWERS[state]}`}>
          <View style={[styles.dot, { backgroundColor: COLORS[state] }]} />
          <Text style={styles.title}>{title}</Text>
          <Text style={[styles.answer, { color: COLORS[state] }]}>{detail ?? ANSWERS[state]}</Text>
        </View>
      ))}
      <Text style={styles.note}>Flexão e extensão pela articulação · amarelo indica leitura incerta</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: '100%', backgroundColor: '#141C18', borderColor: '#29352D', borderWidth: 1, borderRadius: 18, padding: 20, gap: 16 },
  heading: { color: '#92A18D', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  title: { color: '#AAB8A5', fontSize: 11, flexGrow: 1 },
  answer: { fontSize: 10, fontWeight: '600', flexShrink: 1 },
  note: { fontSize: 10, lineHeight: 17, color: '#7E8D80', borderTopWidth: 1, borderTopColor: '#29352D', paddingTop: 12 },
});