import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { BookOpen, RotateCcw, Mic, BarChart3, Bookmark } from 'lucide-react-native';

import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants';

import Sidebar          from '../components/layout/Sidebar';
import OnboardingScreen from '../screens/OnboardingScreen';
import AuthScreen       from '../screens/AuthScreen';
import DashboardScreen  from '../screens/DashboardScreen';
import QuranListScreen  from '../screens/QuranListScreen';
import DetailScreen     from '../screens/DetailScreen';
import ReciteScreen     from '../screens/ReciteScreen';
import TrackScreen      from '../screens/TrackScreen';
import RetainScreen     from '../screens/RetainScreen';
import RetainResultsScreen from '../screens/RetainResultsScreen';
import SessionsScreen   from '../screens/SessionsScreen';
import SessionDetailScreen from '../screens/SessionDetailScreen';
import BookmarksScreen  from '../screens/secondary/BookmarksScreen';
import ProfileScreen    from '../screens/secondary/ProfileScreen';
import SettingsScreen   from '../screens/secondary/SettingsScreen';
import HelpScreen       from '../screens/secondary/HelpScreen';

const Stack  = createNativeStackNavigator();
const Tab    = createBottomTabNavigator();
const Drawer = createDrawerNavigator();

function BottomTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   COLORS.primary,
        tabBarInactiveTintColor: COLORS.gray400,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderTopColor: COLORS.gray100,
          borderTopWidth: 1,
          height: 62 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
        },
      }}
    >
      <Tab.Screen name="QuranList" component={QuranListScreen} options={{ tabBarLabel: 'Read',   tabBarIcon: ({ color, size }) => <BookOpen  size={size} color={color} /> }} />
      <Tab.Screen name="Retain"    component={RetainScreen}    options={{ tabBarLabel: 'Retain', tabBarIcon: ({ color, size }) => <RotateCcw size={size} color={color} /> }} />
      <Tab.Screen name="Recite"    component={ReciteScreen}    options={{ tabBarLabel: 'Recite', tabBarIcon: ({ color, size }) => <Mic       size={size} color={color} /> }} />
      <Tab.Screen name="Track"     component={TrackScreen}     options={{ tabBarLabel: 'Track',  tabBarIcon: ({ color, size }) => <BarChart3 size={size} color={color} /> }} />
      <Tab.Screen name="Bookmarks" component={BookmarksScreen} options={{ tabBarLabel: 'Save',   tabBarIcon: ({ color, size }) => <Bookmark  size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

function MainDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerPosition: 'left',
        drawerType: 'slide',
        overlayColor: 'rgba(0,0,0,0.18)',
        swipeEnabled: true,
        swipeEdgeWidth: 60,
      }}
    >
      <Drawer.Screen name="Dashboard" component={DashboardScreen} />
      <Drawer.Screen name="MainTabs"  component={BottomTabs} />
      <Drawer.Screen name="Profile"   component={ProfileScreen} />
      <Drawer.Screen name="Settings"  component={SettingsScreen} />
      <Drawer.Screen name="Help"      component={HelpScreen} />
    </Drawer.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Auth"       component={AuthScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main"           component={MainDrawer} />
            <Stack.Screen name="Detail"         component={DetailScreen} />
            <Stack.Screen name="RetainResults"  component={RetainResultsScreen} />
            <Stack.Screen name="Sessions"       component={SessionsScreen} />
            <Stack.Screen name="SessionDetail"  component={SessionDetailScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
