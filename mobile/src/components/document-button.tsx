import * as DocumentPicker from 'expo-document-picker';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { StudioIcon } from './studio-visuals';

export type DocumentButtonProps = {
  buttonTitle?: string;
  documentCallback?: (uri: string) => void;
  disabled?: boolean;
  compact?: boolean;
};

export default function DocumentButton({ buttonTitle = 'Enviar arquivo', documentCallback, disabled = false, compact = false }: DocumentButtonProps) {
  const handleButtonPress = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, type: 'video/*' });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset) documentCallback?.(asset.uri);
  };
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} onPress={handleButtonPress} disabled={disabled} activeOpacity={0.8} style={[styles.button, compact && styles.compact, disabled && styles.disabled]}>
      <StudioIcon name="upload" size={compact ? 15 : 18} color={compact ? '#C7DEAE' : '#19250D'} />
      <Text style={[styles.label, compact && styles.compactLabel]}>{buttonTitle}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#C5F566', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10, minHeight: 46 },
  label: { color: '#19250D', fontSize: 13, fontWeight: '700' },
  compact: { minHeight: 36, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#26351F', borderWidth: 1, borderColor: '#435B32', borderRadius: 8 },
  compactLabel: { color: '#C7DEAE', fontSize: 11 },
  disabled: { opacity: 0.45 },
});