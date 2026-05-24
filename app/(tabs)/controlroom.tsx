import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

export default function ControlRoomScreen() {
  return (
    <View style={s.root}>
      <Text style={s.title}>// control room</Text>
      <Text style={s.sub}>coming in v2</Text>
      <TouchableOpacity style={s.back} onPress={() => router.back()}>
        <Text style={s.backText}>← back</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080d14', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONT, fontSize: 18, color: '#a855f7', letterSpacing: 2, marginBottom: 8 },
  sub: { fontFamily: FONT, fontSize: 12, color: '#444', marginBottom: 32 },
  back: { paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#222', borderRadius: 4 },
  backText: { fontFamily: FONT, fontSize: 12, color: '#888' },
});
