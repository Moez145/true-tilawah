import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image, Alert,
  ActivityIndicator, Platform, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Eye, EyeOff } from 'lucide-react-native';
import Input    from '../components/common/Input';
import Button   from '../components/common/Button';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import { COLORS, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '../constants';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthScreen({ navigation }) {
  const { login, register } = useAuth();
  const [mode,        setMode]        = useState('login'); // 'login' | 'register'
  const [showPwd,     setShowPwd]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading,  setAppleLoading]  = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});

  // Google OAuth
  const [, googleResponse, googlePrompt] = Google.useAuthRequest({
    webClientId:     GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId:     GOOGLE_IOS_CLIENT_ID,
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') handleGoogleResult(googleResponse);
  }, [googleResponse]);

  const setField = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    if (errors[k]) setErrors(p => ({ ...p, [k]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (mode === 'register' && !form.fullName.trim()) e.fullName = 'Full name is required';
    if (!form.email.trim())       e.email    = 'Email is required';
    else if (!EMAIL_RE.test(form.email)) e.email = 'Enter a valid email';
    if (!form.password)           e.password = 'Password is required';
    else if (form.password.length < 8) e.password = 'Minimum 8 characters';
    else if (mode === 'register' && !/[A-Z]/.test(form.password)) e.password = 'Must include an uppercase letter';
    else if (mode === 'register' && !/[0-9]/.test(form.password)) e.password = 'Must include a number';
    if (mode === 'register') {
      if (!form.confirm)              e.confirm = 'Please confirm your password';
      else if (form.confirm !== form.password) e.confirm = 'Passwords do not match';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      if (mode === 'register') await register({ fullName: form.fullName.trim(), email: form.email.trim(), password: form.password });
      else await login({ email: form.email.trim(), password: form.password });
    } catch (err) {
      // Surface backend-level validation errors (express-validator returns an `errors` array)
      const data = err.response?.data;
      const detail = Array.isArray(data?.errors) && data.errors.length
        ? data.errors.map(x => x.msg || x.message).filter(Boolean).join('\n')
        : null;
      Alert.alert('Error', detail || data?.message || err.message || 'Something went wrong');
    } finally { setLoading(false); }
  };

  const handleGoogleResult = async (response) => {
    setGoogleLoading(true);
    try {
      await authService.handleGoogleResponse(response);
    } catch (err) {
      Alert.alert('Notice', err.message || 'Google login not available. Use email/password.');
    } finally { setGoogleLoading(false); }
  };

  const handleApple = async () => {
    setAppleLoading(true);
    try {
      await authService.signInWithApple();
    } catch (err) {
      if (err.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Notice', err.message || 'Apple login not available. Use email/password.');
      }
    } finally { setAppleLoading(false); }
  };

  const EyeBtn = (
    <TouchableOpacity onPress={() => setShowPwd(p => !p)} hitSlop={8}>
      {showPwd ? <EyeOff size={20} color={COLORS.gray400} /> : <Eye size={20} color={COLORS.gray400} />}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.appTitle}>True Tilawah</Text>
        <Text style={styles.subtitle}>Log in or register to{'\n'}save your progress</Text>

        {/* Tabs */}
        <View style={styles.tabs}>
          {[{ key: 'login', label: 'Sign in' }, { key: 'register', label: 'Register' }].map(t => (
            <TouchableOpacity key={t.key} style={[styles.tab, mode === t.key && styles.tabActive]}
              onPress={() => { setMode(t.key); setErrors({}); }}>
              <Text style={[styles.tabText, mode === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Form */}
        <View style={styles.form}>
          {mode === 'register' && (
            <Input label="Full Name" placeholder="Ahmed Ali" value={form.fullName}
              onChangeText={v => setField('fullName', v)} error={errors.fullName}
              autoCapitalize="words" returnKeyType="next" />
          )}
          <Input label="Email" placeholder="example@gmail.com" value={form.email}
            onChangeText={v => setField('email', v)} error={errors.email}
            keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
          <Input label={mode === 'register' ? 'Create a password' : 'Password'}
            placeholder={mode === 'register' ? '8+ chars, 1 uppercase, 1 number' : 'Your password'} value={form.password}
            onChangeText={v => setField('password', v)} error={errors.password}
            secureTextEntry={!showPwd} rightElement={EyeBtn} returnKeyType={mode === 'register' ? 'next' : 'done'} />
          {mode === 'register' && (
            <Input label="Confirm password" placeholder="repeat password" value={form.confirm}
              onChangeText={v => setField('confirm', v)} error={errors.confirm}
              secureTextEntry={!showPwd} rightElement={EyeBtn} returnKeyType="done"
              onSubmitEditing={handleSubmit} />
          )}
          <Button onPress={handleSubmit} size="full" loading={loading} style={styles.submitBtn}>
            {mode === 'register' ? 'Register' : 'Log in'}
          </Button>
        </View>

        {/* Divider */}
        <View style={styles.divRow}>
          <View style={styles.divLine} />
          <Text style={styles.divText}>Or {mode === 'register' ? 'Register' : 'Sign in'} with</Text>
          <View style={styles.divLine} />
        </View>

        {/* Social */}
        {/* <View style={styles.socialRow}>
          <TouchableOpacity style={styles.socialBtn} activeOpacity={0.7}>
            <Image source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/5/51/Facebook_f_logo_%282019%29.svg' }} style={styles.socialIcon} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.socialBtn} onPress={() => { setGoogleLoading(true); googlePrompt(); }} disabled={googleLoading} activeOpacity={0.7}>
            {googleLoading
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : <Image source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg' }} style={styles.socialIcon} />}
          </TouchableOpacity>
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={styles.socialBtn} onPress={handleApple} disabled={appleLoading} activeOpacity={0.7}>
              {appleLoading
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Image source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg' }} style={[styles.socialIcon, { tintColor: '#000' }]} />}
            </TouchableOpacity>
          )}
        </View> */}

        <Text style={styles.switchText}>
          {mode === 'register' ? 'Already have an account? ' : "Don't have an account? "}
          <Text style={styles.switchLink} onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setErrors({}); }}>
            {mode === 'register' ? 'Log in' : 'Register'}
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: COLORS.white },
  scroll:        { flexGrow: 1, paddingHorizontal: 32, paddingTop: 28, paddingBottom: 40 },
  appTitle:      { fontSize: 32, fontWeight: '700', color: COLORS.primary, textAlign: 'center', marginBottom: 8 },
  subtitle:      { fontSize: 15, color: COLORS.gray500, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  tabs:          { flexDirection: 'row', backgroundColor: COLORS.gray100, borderRadius: 16, padding: 4, marginBottom: 28 },
  tab:           { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  tabActive:     { backgroundColor: COLORS.white, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  tabText:       { fontSize: 15, fontWeight: '700', color: COLORS.gray500 },
  tabTextActive: { color: COLORS.primary },
  form:          { gap: 18, marginBottom: 24 },
  submitBtn:     { marginTop: 4 },
  divRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 10 },
  divLine:       { flex: 1, height: 1, backgroundColor: COLORS.gray200 },
  divText:       { fontSize: 11, fontWeight: '700', color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 0.5 },
  socialRow:     { flexDirection: 'row', justifyContent: 'center', gap: 18, marginBottom: 30 },
  socialBtn:     { width: 56, height: 56, borderRadius: 16, borderWidth: 1, borderColor: COLORS.gray100, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  socialIcon:    { width: 28, height: 28, resizeMode: 'contain' },
  switchText:    { textAlign: 'center', fontSize: 14, color: COLORS.gray500 },
  switchLink:    { fontWeight: '700', color: COLORS.primary },
});
