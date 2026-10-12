import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { VideoAssessment } from '../utils/video-assessment';

export default function VideoAssessmentCard({ assessment }: { assessment: VideoAssessment }) {
  const color = assessment.status === 'adequate' ? '#C5F566' : assessment.status === 'insufficient' ? '#F59A8C' : '#F2CD75';
  return <View style={[styles.card, { borderColor: color }]} accessibilityLabel="Resultado do vídeo">
    <Text style={styles.label}>RESULTADO DO VÍDEO</Text>
    <Text style={[styles.title, { color }]}>{assessment.title}</Text>
    <Text style={styles.total}>{assessment.repetitions} repetições confirmadas no trecho</Text>
    <Text style={styles.evidence}>Pose estável: {assessment.trackedFrames}/{assessment.totalFrames} quadros · Leitura utilizável: {assessment.readableFrames}/{assessment.totalFrames}</Text>
    {assessment.findings.map(finding => <View key={finding.code} style={styles.finding}>
      <Text style={styles.findingTitle}>{finding.title}</Text>
      <Text style={styles.body}>{finding.detail}</Text>
      <Text style={styles.action}>{finding.action}</Text>
    </View>)}
    {assessment.status === 'adequate' && <Text style={styles.body}>O rastreamento e a leitura foram consistentes e houve ciclos confirmados. Confira os intervalos no replay.</Text>}
    <Text style={styles.note}>{assessment.note}</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#141C18', borderWidth: 1, borderRadius: 18, padding: 20, gap: 12, width: '100%' },
  label: { color: '#92A18D', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { fontSize: 22, fontWeight: '700' }, total: { color: '#EEF4E9', fontSize: 15, fontWeight: '600' },
  evidence: { color: '#AAB8A5', fontSize: 11, lineHeight: 18 },
  finding: { borderTopColor: '#29352D', borderTopWidth: 1, paddingTop: 12, gap: 6 },
  findingTitle: { color: '#EEF4E9', fontSize: 14, fontWeight: '600' },
  body: { color: '#B6C1B2', fontSize: 13, lineHeight: 20 }, action: { color: '#D5E4CB', fontSize: 12, lineHeight: 19 },
  note: { color: '#92A18D', fontSize: 11, lineHeight: 18 },
});
