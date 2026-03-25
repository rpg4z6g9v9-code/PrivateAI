import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import 'react-native-reanimated';
import secureStorage from '@/services/secureStorage';

const ONBOARDING_COMPLETE_KEY = 'onboarding_complete_v1';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Force a custom dark theme regardless of system appearance.
const AppTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#080d14',
    card:        '#080d14',
  },
};

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    secureStorage.getItem(ONBOARDING_COMPLETE_KEY).then(val => {
      if (val !== 'true') {
        // Defer navigation to after layout mount
        setTimeout(() => router.replace('/onboarding'), 0);
      }
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#080d14', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#4db8ff" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={AppTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
          {/* modal screen removed — unused */}
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
