import React from 'react';
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { User, Settings, Bookmark, HelpCircle, LogOut, X } from 'lucide-react-native';
import SidebarItem from '../common/SidebarItem';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { COLORS, BRAND_GRADIENT } from '../../constants';

export default function Sidebar({ navigation }) {
  const { user, logout } = useAuth();
  const { localAvatarUri } = useApp();

  const close = () => navigation.closeDrawer();
  const nav   = (screen) => { close(); navigation.navigate(screen); };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.header}>
        <View style={styles.headerTop}>
          <Image
            source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
            style={styles.avatar}
          />
          <TouchableOpacity onPress={close} style={styles.closeBtn} hitSlop={8}>
            <X size={22} color="rgba(255,255,255,0.9)" />
          </TouchableOpacity>
        </View>
        <Text style={styles.name}>{user?.fullName || 'User'}</Text>
        <Text style={styles.level}>Beginner Student</Text>
      </LinearGradient>

      {/* Nav */}
      <ScrollView style={styles.nav} showsVerticalScrollIndicator={false}>
        <View style={styles.navItems}>
          <SidebarItem icon={<User    size={20} color={COLORS.primary} />} label="My Profile"    onPress={() => nav('Profile')} />
          <SidebarItem icon={<Settings size={20} color={COLORS.primary} />} label="Settings"     onPress={() => nav('Settings')} />
          <SidebarItem icon={<Bookmark size={20} color={COLORS.primary} />} label="Saved Verses" onPress={() => { close(); navigation.navigate('MainTabs', { screen: 'Bookmarks' }); }} />
          <SidebarItem icon={<HelpCircle size={20} color={COLORS.primary} />} label="Help & Support" onPress={() => nav('Help')} />
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.divider} />
        <SidebarItem icon={<LogOut size={20} color={COLORS.red} />} label="Logout" onPress={async () => { close(); await logout(); }} danger />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header:    { paddingTop: 60, paddingBottom: 24, paddingHorizontal: 24 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  avatar:    { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  closeBtn:  { padding: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)' },
  name:      { fontSize: 20, fontWeight: '700', color: COLORS.white },
  level:     { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 4 },
  nav:       { flex: 1 },
  navItems:  { padding: 16, gap: 4 },
  footer:    { padding: 16, paddingBottom: 36 },
  divider:   { height: 1, backgroundColor: COLORS.gray100, marginBottom: 8 },
});
