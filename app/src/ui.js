// Shared look for the app: the same palette as the doctor dashboard (teal = the cabinet's own colour),
// status colours only for status, and each medicine shown as a capsule in its pill colour.
// System font on purpose: it follows the phone's text-size setting, which older family members rely on.
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export const colors = {
  bg: '#EEF3F3', card: '#FFFFFF', text: '#12282E', muted: '#4F666C', line: '#DCE6E8', line2: '#C3D2D6',
  primary: '#0E7490', primaryInk: '#155E75', primaryWash: '#E6F3F5',
  taken: '#15803D', takenWash: '#E6F4EA', missed: '#B91C1C', missedWash: '#FCEBEB', pending: '#B45309', pendingWash: '#FDF1DF',
  cab: '#155E75', well: '#0B3943',
};

const PILL = {
  blue: '#2563EB', red: '#DC2626', yellow: '#EAB308', green: '#16A34A',
  white: '#F1F5F9', orange: '#EA580C', pink: '#DB2777', purple: '#7C3AED',
};
export const pillColor = (c) => (c && PILL[c.toLowerCase()]) || c || '#94A3B8';

// "Minh (grandson)" -> "MG"
export const initials = (name = '') => name.split(/[\s().,]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

// Sentence-case section heading, with an optional action on the right
export function Section({ title, action, children, style }) {
  return (
    <View style={[s.section, style]}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle} accessibilityRole="header">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', big, disabled, style }) {
  const k = KINDS[kind];
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [s.btn, big && s.big, { backgroundColor: k.bg, borderColor: k.border },
        pressed && !disabled && { opacity: 0.75 }, disabled && { opacity: 0.55 }, style]}>
      <Text style={[s.btnText, big && s.bigText, { color: k.fg }]}>{title}</Text>
    </Pressable>
  );
}
const KINDS = {
  primary: { bg: colors.primary, border: colors.primary, fg: '#fff' },
  secondary: { bg: colors.card, border: colors.line2, fg: colors.text },
  quiet: { bg: 'transparent', border: 'transparent', fg: colors.primaryInk },
  done: { bg: colors.taken, border: colors.taken, fg: '#fff' },
};

// A real capsule: two halves of the pill's colour; the edge keeps a white pill visible
export function Capsule({ color, size = 1 }) {
  const c = pillColor(color);
  return (
    <View style={[s.capsule, { width: 26 * size, height: 13 * size }]}>
      <View style={{ flex: 1, backgroundColor: c }} />
      <View style={{ flex: 1, backgroundColor: c, opacity: 0.55 }} />
    </View>
  );
}

const STATUS = {
  taken: [colors.takenWash, colors.taken, '✓'], missed: [colors.missedWash, colors.missed, '✕'],
  due: [colors.primary, '#fff', '●'], later: [colors.bg, colors.muted, ''],
};
export function Status({ status, text }) {
  const [bg, fg, mark] = STATUS[status] ?? STATUS.later;
  return (
    <View style={[s.status, { backgroundColor: bg }]}>
      <Text style={[s.statusText, { color: fg }]}>{mark ? `${mark} ` : ''}{text}</Text>
    </View>
  );
}

export function Avatar({ name, size = 40 }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={[s.avatarText, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  );
}

export function Badge({ count }) {
  return <View style={s.badge}><Text style={s.badgeText}>{count}</Text></View>;
}

// Segmented control: a few equal choices (tabs, roles)
export function Tabs({ tabs, value, onChange, style }) {
  return (
    <View style={[s.seg, style]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = value === t;
        return (
          <Pressable key={t} onPress={() => onChange(t)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[s.segBtn, on && s.segOn]}>
            <Text style={[s.segText, on && { color: colors.text }]}>{t}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, hint, style, ...props }) {
  return (
    <View style={[{ marginBottom: 14 }, style]}>
      <Text style={s.label}>{label}{hint ? <Text style={s.hint}>  {hint}</Text> : null}</Text>
      <TextInput style={s.input} placeholderTextColor="#7F9398" autoCorrect={false} accessibilityLabel={label} {...props} />
    </View>
  );
}

// Yes/no question -> Promise<boolean>. Alert.alert buttons don't work in a browser, so web uses window.confirm.
export function ask(title, message, yes) {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'Keep', style: 'cancel', onPress: () => resolve(false) },
    { text: yes, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function ErrorText({ children }) {
  return children ? <Text style={s.error} accessibilityRole="alert">{children}</Text> : null;
}

// The cabinet as a mark: boxes 1-3, 4-6, the long box 7, with box 2 lit
export function Logo({ size = 28 }) {
  const u = size / 34;
  const door = (lit) => ({ width: 6.6 * u, height: 8.2 * u, borderRadius: 1.2 * u, backgroundColor: lit ? '#FBBF24' : '#fff' });
  return (
    <View style={{ width: size, height: size, borderRadius: 9 * u, backgroundColor: colors.primary, padding: 6 * u, gap: 1 * u }}>
      {[0, 1].map((r) => (
        <View key={r} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[0, 1, 2].map((c) => <View key={c} style={door(r === 0 && c === 1)} />)}
        </View>
      ))}
      <View style={{ height: 3.8 * u, borderRadius: 1.2 * u, backgroundColor: '#fff' }} />
    </View>
  );
}

// "2026-10-24..." -> "Oct 24"; with the year: "Oct 24, 2026". Manual so it doesn't depend on Intl on the phone.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (iso, year = false) =>
  iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}${year ? `, ${iso.slice(0, 4)}` : ''}` : '';

// "08:00" -> "8:00 AM"
export function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  section: { marginTop: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, minHeight: 28 },
  sectionTitle: { fontSize: 19, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  btn: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  big: { minHeight: 60, borderRadius: 14 },
  btnText: { fontSize: 16, fontWeight: '600' },
  bigText: { fontSize: 20, fontWeight: '700' },
  capsule: { flexDirection: 'row', borderRadius: 999, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.25)' },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  statusText: { fontSize: 13, fontWeight: '700' },
  avatar: { backgroundColor: colors.primaryWash, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryInk, fontWeight: '700' },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.missed, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  seg: { flexDirection: 'row', backgroundColor: '#E1E9EA', borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.card, shadowColor: '#12282E', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 6 },
  hint: { fontSize: 13, fontWeight: '400', color: colors.muted },
  input: { minHeight: 50, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line2, borderRadius: 12,
           paddingHorizontal: 14, fontSize: 17, color: colors.text },
  error: { color: colors.missed, backgroundColor: colors.missedWash, borderRadius: 10, padding: 12, fontSize: 15, marginVertical: 8 },
});
