import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { COLORS } from '../../constants';

export default function Input({ label, error, leftElement, rightElement, style, inputStyle, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrapper, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[
        styles.box,
        focused && styles.boxFocused,
        error  && styles.boxError,
      ]}>
        {leftElement  && <View style={styles.leftEl}>{leftElement}</View>}
        <TextInput
          style={[styles.input, leftElement && { paddingLeft: 4 }, rightElement && { paddingRight: 4 }, inputStyle]}
          placeholderTextColor={COLORS.gray400}
          onFocus={() => setFocused(true)}
          onBlur={()  => setFocused(false)}
          {...props}
        />
        {rightElement && <View style={styles.rightEl}>{rightElement}</View>}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:    { width: '100%', gap: 6 },
  label:      { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  box:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 12, backgroundColor: COLORS.white },
  boxFocused: { borderColor: COLORS.primary },
  boxError:   { borderColor: COLORS.red },
  input:      { flex: 1, paddingVertical: 15, paddingHorizontal: 16, fontSize: 15, color: COLORS.primary },
  leftEl:     { paddingLeft: 14 },
  rightEl:    { paddingRight: 14 },
  error:      { fontSize: 12, color: COLORS.red, fontWeight: '500' },
});
