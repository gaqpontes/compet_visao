import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getEndpointThresholds } from '../utils/endpoint-tolerance';

export default function EndpointToleranceControl({ value, min, max, disabled, recalculate, onChange }: {
  value: number; min: number; max: number; disabled?: boolean; recalculate?: boolean; onChange: (value: number) => void;
}) {
  const endpoints = getEndpointThresholds(min, max, value);
  return <View style={styles.panel}>
    <Text style={styles.title}>Próximo o suficiente: {value}%</Text>
    <View style={styles.options}>
      {[0, 5, 10, 15, 20, 25, 30, 35, 40].map(percent => <TouchableOpacity
        key={percent} accessibilityRole="radio" accessibilityState={{ checked: value === percent, disabled }}
        accessibilityLabel={`Tolerância dos extremos: ${percent}%`} disabled={disabled}
        onPress={() => onChange(percent)} style={[styles.option, value === percent && styles.selected, disabled && { opacity: 0.5 }]}>
        <Text style={[styles.text, value === percent && styles.active]}>{percent}%</Text>
      </TouchableOpacity>)}
    </View>
    <Text style={styles.note}>Margem sobre a faixa angular do exercício. Menor é mais exigente. Flexão até {endpoints.flexion.toFixed(1)}° · extensão a partir de {endpoints.extension.toFixed(1)}°.</Text>
    <Text style={styles.note}>{recalculate ? 'Ajustar recalcula a contagem e o gráfico com os pontos já analisados.' : 'Alterar reinicia a contagem ao vivo.'} Não é uma avaliação da técnica do exercício.</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { backgroundColor: '#141C18', borderColor: '#29352D', borderWidth: 1, borderRadius: 18, padding: 16, gap: 10, width: '100%' },
  title: { color: '#EEF4E9', fontWeight: '600', fontSize: 14 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { borderWidth: 1, borderColor: '#3D4B3C', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },
  selected: { borderColor: '#C5F566', backgroundColor: '#C5F566' },
  text: { color: '#C9D6BF', fontSize: 12 }, active: { color: '#18230E', fontWeight: '700' },
  note: { color: '#92A18D', fontSize: 11, lineHeight: 17 },
});
