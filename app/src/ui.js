import { Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = {
  bg: '#F6F7F9', card: '#FFFFFF', text: '#1B1F24', muted: '#667085', line: '#E4E7EC',
  primary: '#2563EB', taken: '#16A34A', missed: '#DC2626', pending: '#D97706',
};

export const statusColor = (s) => colors[s] || colors.muted;

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Title({ children }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Button({ title, onPress, kind = 'primary', big }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      s.btn, kind === 'ghost' && s.ghost, big && s.big, pressed && { opacity: 0.7 }]}>
      <Text style={[s.btnText, kind === 'ghost' && { color: colors.primary }, big && { fontSize: 22 }]}>{title}</Text>
    </Pressable>
  );
}

export function Pill({ text, color }) {
  return <Text style={[s.pill, { backgroundColor: color }]}>{text}</Text>;
}

export function Dot({ color }) {
  return <View style={[s.dot, { backgroundColor: color, borderColor: colors.line }]} />;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <View style={s.tabs}>
      {tabs.map((t) => (
        <Pressable key={t} onPress={() => onChange(t)} style={[s.tab, value === t && s.tabOn]}>
          <Text style={[s.tabText, value === t && { color: colors.primary }]}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10,
          borderWidth: 1, borderColor: colors.line },
  title: { fontSize: 15, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 8,
           textTransform: 'uppercase', letterSpacing: 0.5 },
  btn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16,
         alignItems: 'center', marginVertical: 4 },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  big: { paddingVertical: 20 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  pill: { color: '#fff', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3,
          borderRadius: 999, overflow: 'hidden' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, marginRight: 10 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn: { borderBottomWidth: 3, borderColor: colors.primary },
  tabText: { fontSize: 16, fontWeight: '600', color: colors.muted },
});
