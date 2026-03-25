import { Stack } from 'expo-router';

export default function TabLayout() {
  return (
    <Stack screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: '#080d14' },
    }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="map" />
      <Stack.Screen name="medical" />
      <Stack.Screen name="conversations" />
      <Stack.Screen name="controlroom" />
      <Stack.Screen name="security" />
      <Stack.Screen name="dashboard" />
    </Stack>
  );
}
