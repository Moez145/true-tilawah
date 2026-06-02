import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  TextInput, Image, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  Bookmark, Settings, Eye,
  CheckCircle2, Search, ChevronRight,
} from 'lucide-react-native';
import Header from '../../components/common/Header';
import { useAuth } from '../../context/AuthContext';
import { useApp }  from '../../context/AppContext';
import { COLORS }  from '../../constants';
import { getShadow } from '../../utils/helpers';

// ─── Bookmarks ────────────────────────────────────────────────────────────────
export function BookmarksScreen({ navigation }) {
  const { bookmarks } = useApp();
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="Bookmarks" onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {bookmarks.length === 0 ? (
          <View style={s.empty}>
            <Bookmark size={52} color={COLORS.gray300} />
            <Text style={s.emptyTitle}>No bookmarks yet</Text>
            <Text style={s.emptySub}>Bookmark ayahs while reading to save them here</Text>
          </View>
        ) : (
          bookmarks.map((b, i) => (
            <TouchableOpacity
              key={`${b.surahId}-${b.ayahNumber}-${i}`}
              style={[s.collectionItem, getShadow(2)]}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Detail', {
                surahNumber: b.surahId,
                title:       b.surahName,
                mode:        'surah',
              })}
            >
              <View style={s.collectionLeft}>
                <View style={s.collectionIcon}><Bookmark size={22} color={COLORS.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.collectionTitle}>{b.surahName} : {b.ayahNumber}</Text>
                  <Text style={s.collectionMeta} numberOfLines={1}>{b.text}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────
export function ProfileScreen({ navigation }) {
  const { user } = useAuth();
  const { localAvatarUri, setLocalAvatarUri } = useApp();

  const pickAvatar = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo access needed',
          'Please allow photo library access in your phone Settings to choose a profile picture.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (uri) setLocalAvatarUri(uri);
    } catch (e) {
      Alert.alert("Couldn't pick photo", e?.message || 'Please try again.');
    }
  }, [setLocalAvatarUri]);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="My Profile" onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.profileContent} showsVerticalScrollIndicator={false}>
        <View style={s.avatarWrap}>
          <Image
            source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
            style={s.avatar}
          />
          <TouchableOpacity style={s.editBtn} onPress={pickAvatar} activeOpacity={0.7}>
            <Settings size={14} color={COLORS.white} />
          </TouchableOpacity>
        </View>
        <Text style={s.profileName}>{user?.fullName || 'User'}</Text>
        <Text style={s.profileLevel}>Beginner Student</Text>
        <View style={s.fields}>
          {[
            { label: 'Full Name', value: user?.fullName || '—' },
            { label: 'Email',     value: user?.email    || '—' },
            { label: 'Joined',    value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—' },
          ].map(f => (
            <View key={f.label} style={s.field}>
              <Text style={s.fieldLabel}>{f.label}</Text>
              <Text style={s.fieldValue}>{f.value}</Text>
            </View>
          ))}
        </View>
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export function SettingsScreen({ navigation }) {
  const [dark,   setDark]   = useState(false);
  const [notifs, setNotifs] = useState(true);
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="Settings" onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {[
          { icon: Eye,          iconBg: '#EFF6FF', iconColor: '#3B82F6', label: 'Dark Mode',    value: dark,   set: setDark },
          { icon: CheckCircle2, iconBg: '#ECFDF5', iconColor: '#10B981', label: 'Notifications', value: notifs, set: setNotifs },
        ].map(item => {
          const Ico = item.icon;
          return (
            <View key={item.label} style={[s.settingRow, getShadow(1)]}>
              <View style={s.settingLeft}>
                <View style={[s.settingIcon, { backgroundColor: item.iconBg }]}>
                  <Ico size={20} color={item.iconColor} />
                </View>
                <Text style={s.settingLabel}>{item.label}</Text>
              </View>
              <Switch value={item.value} onValueChange={item.set} trackColor={{ false: COLORS.gray200, true: COLORS.primary }} thumbColor={COLORS.white} />
            </View>
          );
        })}
        {['Privacy Policy', 'Terms of Service', 'About True Tilawah', 'App Version 1.0.0'].map(item => (
          <TouchableOpacity key={item} style={[s.settingRow, getShadow(1)]} activeOpacity={0.7}>
            <Text style={s.settingLabel}>{item}</Text>
            <ChevronRight size={18} color={COLORS.gray300} />
          </TouchableOpacity>
        ))}
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Help ─────────────────────────────────────────────────────────────────────
export function HelpScreen({ navigation }) {
  const ITEMS = ['FAQs', 'Contact Us', 'Privacy Policy', 'Terms of Service'];
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="Help & Support" onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.helpSearch}>
          <Text style={s.helpTitle}>How can we help?</Text>
          <Text style={s.helpSub}>Search our help center or contact our support team.</Text>
          <View style={s.helpInputRow}>
            <Search size={18} color={COLORS.gray400} />
            <TextInput style={s.helpInput} placeholder="Search for help..." placeholderTextColor={COLORS.gray400} />
          </View>
        </View>
        {ITEMS.map(item => (
          <TouchableOpacity key={item} style={s.helpItem} activeOpacity={0.7}>
            <Text style={s.helpItemTxt}>{item}</Text>
            <ChevronRight size={20} color={COLORS.gray300} />
          </TouchableOpacity>
        ))}
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen:          { flex: 1, backgroundColor: COLORS.white },
  content:         { padding: 24, gap: 12 },
  profileContent:  { padding: 32, alignItems: 'center' },

  // Bookmarks
  empty:           { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle:      { fontSize: 18, fontWeight: '700', color: COLORS.gray400 },
  emptySub:        { fontSize: 14, color: COLORS.gray400, textAlign: 'center', lineHeight: 20 },
  collectionItem:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 16, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray100 },
  collectionLeft:  { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  collectionIcon:  { width: 44, height: 44, borderRadius: 13, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center', justifyContent: 'center' },
  collectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  collectionMeta:  { fontSize: 10, color: COLORS.gray400, marginTop: 2 },

  // Profile
  avatarWrap:      { position: 'relative', marginBottom: 14 },
  avatar:          { width: 110, height: 110, borderRadius: 55, borderWidth: 4, borderColor: `${COLORS.primary}20` },
  editBtn:         { position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  profileName:     { fontSize: 24, fontWeight: '700', color: COLORS.primary, marginBottom: 4 },
  profileLevel:    { fontSize: 14, color: COLORS.gray500, marginBottom: 28 },
  fields:          { width: '100%', gap: 10 },
  field:           { backgroundColor: COLORS.gray100, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel:      { fontSize: 14, color: COLORS.gray500 },
  fieldValue:      { fontSize: 14, fontWeight: '700', color: COLORS.primary },

  // Settings
  settingRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.white, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: COLORS.gray100 },
  settingLeft:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingIcon:     { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  settingLabel:    { fontSize: 15, fontWeight: '700', color: COLORS.primary },

  // Help
  helpSearch:      { backgroundColor: COLORS.secondaryUltraLight, borderRadius: 22, padding: 22, marginBottom: 6 },
  helpTitle:       { fontSize: 18, fontWeight: '700', color: COLORS.primary, marginBottom: 6 },
  helpSub:         { fontSize: 13, color: `${COLORS.primary}AA`, lineHeight: 20, marginBottom: 14 },
  helpInputRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.white, borderRadius: 12, padding: 12 },
  helpInput:       { flex: 1, fontSize: 14, color: COLORS.primary },
  helpItem:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 14 },
  helpItemTxt:     { fontSize: 15, fontWeight: '700', color: COLORS.primary },
});
