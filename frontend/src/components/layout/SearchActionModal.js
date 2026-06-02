import React from 'react';
import { View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import { BookOpen, Mic } from 'lucide-react-native';
import { COLORS } from '../../constants';

export default function SearchActionModal({ visible, onClose, onMemorize, onRecite }) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.card}>
              <Text style={styles.title}>Choose Action</Text>
              <Text style={styles.subtitle}>How would you like to continue with this verse?</Text>
              <View style={styles.btns}>
                <TouchableOpacity style={styles.primaryBtn} onPress={onMemorize} activeOpacity={0.85}>
                  <BookOpen size={20} color={COLORS.white} />
                  <Text style={styles.primaryText}>Memorize</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={onRecite} activeOpacity={0.85}>
                  <Mic size={20} color={COLORS.primary} />
                  <Text style={styles.secondaryText}>Recite</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card:          { backgroundColor: COLORS.white, borderRadius: 32, padding: 32, width: '100%', maxWidth: 360, shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.25, shadowRadius: 40, elevation: 20 },
  title:         { fontSize: 20, fontWeight: '700', color: COLORS.primary, textAlign: 'center', marginBottom: 8 },
  subtitle:      { fontSize: 14, color: COLORS.gray500, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  btns:          { gap: 12 },
  primaryBtn:    { backgroundColor: COLORS.primary, borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  primaryText:   { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  secondaryBtn:  { backgroundColor: COLORS.secondaryUltraLight, borderRadius: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  secondaryText: { color: COLORS.primary, fontSize: 16, fontWeight: '700' },
  cancelBtn:     { paddingVertical: 10, alignItems: 'center' },
  cancelText:    { color: COLORS.gray400, fontSize: 14, fontWeight: '700' },
});
