// Shared look for the app: the same calm sage-teal palette as the doctor dashboard (teal = the cabinet's own colour).
// Teal header, flat cards outlined by a hairline (soft.raised); fields and tracks get a faint inset (soft.pressed).
// Status colours only for status, and each medicine shown as a capsule in its pill colour.
// System font on purpose: it follows the phone's text-size setting, which older family members rely on.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Children } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { prefs } from './session';

export const colors = {
  bg: '#E6EEEB', card: '#EEF4F2', text: '#1D302E', muted: '#4E6561', line: '#D3DFDB', line2: '#B9CAC5', placeholder: '#5F7570',
  primary: '#2A6F6B', primaryInk: '#235C58', primaryWash: '#D5E8E3',
  taken: '#356E4A', takenWash: '#DCEBE0', missed: '#A3443B', missedWash: '#F4E1DD', pending: '#8C5A1C', pendingWash: '#F3E6D2',
  cab: '#24605C', well: '#153B38',
};

// Flat depth: a 1px hairline ring plus a short shadow (boxShadow needs the new architecture: Expo 52+)
const LO = 'rgba(84,112,106,0.28)';
export const soft = {
  raised: { boxShadow: `0 0 0 1px ${colors.line}, 0 2px 8px -2px ${LO}` },
  raisedSm: { boxShadow: `0 0 0 1px ${colors.line}, 0 1px 2px ${LO}` },
  pressed: { boxShadow: `inset 0 1px 2px ${LO}` },
  pressedFill: { boxShadow: 'inset 3px 3px 8px rgba(0,0,0,0.28)' }, // a coloured button pushed in
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
        k.flat ? pressed && !disabled && { opacity: 0.6 } : pressed && !disabled ? (k.fill ? soft.pressedFill : soft.pressed) : soft.raisedSm,
        disabled && { opacity: 0.55 }, style]}>
      <Text style={[s.btnText, big && s.bigText, { color: k.fg }]}>{title}</Text>
    </Pressable>
  );
}
const KINDS = {
  primary: { bg: colors.primary, border: colors.primary, fg: '#fff', fill: true },
  secondary: { bg: colors.card, border: 'transparent', fg: colors.text },
  quiet: { bg: 'transparent', border: 'transparent', fg: colors.primaryInk, flat: true },
  done: { bg: colors.taken, border: colors.taken, fg: '#fff', fill: true },
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

// Grouped list (Profile, Settings): rows in one card, split by hairlines. Falsy children are skipped.
export function Group({ children }) {
  const rows = Children.toArray(children);
  return <View style={s.group}>{rows.map((r, i) => <View key={r.key} style={i > 0 && s.rule}>{r}</View>)}</View>;
}

// One row: icon, a small label, the value under it, and an optional control on the right
export function Row({ icon, label, value, children }) {
  return (
    <View style={s.row}>
      <View style={s.rowIcon}><MaterialCommunityIcons name={icon} size={22} color={colors.primaryInk} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {value != null && <Text style={s.rowValue}>{value}</Text>}
      </View>
      {children}
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
      <TextInput style={s.input} placeholderTextColor={colors.placeholder} autoCorrect={false} accessibilityLabel={label} {...props} />
    </View>
  );
}

// Yes/no question -> Promise<boolean>. Alert.alert buttons don't work in a browser, so web uses window.confirm.
export function ask(title, message, yes, no = 'Keep') {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: no, style: 'cancel', onPress: () => resolve(false) },
    { text: yes, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

export function ErrorText({ children }) {
  return children ? <Text style={s.error} accessibilityRole="alert">{children}</Text> : null;
}

// The cabinet as a mark: boxes 1-3, 4-6, the long box 7, with box 2 lit. onColor: white tile for the coloured header.
export function Logo({ size = 28, onColor = false }) {
  const u = size / 34;
  const [body, fg] = onColor ? ['#fff', colors.primary] : [colors.primary, '#fff'];
  const door = (lit) => ({ width: 6.6 * u, height: 8.2 * u, borderRadius: 1.2 * u, backgroundColor: lit ? '#FBBF24' : fg });
  return (
    <View style={{ width: size, height: size, borderRadius: 9 * u, backgroundColor: body, padding: 6 * u, gap: 1 * u }}>
      {[0, 1].map((r) => (
        <View key={r} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[0, 1, 2].map((c) => <View key={c} style={door(r === 0 && c === 1)} />)}
        </View>
      ))}
      <View style={{ height: 3.8 * u, borderRadius: 1.2 * u, backgroundColor: fg }} />
    </View>
  );
}

// "2026-10-24..." -> "Oct 24"; with the year: "Oct 24, 2026". Manual so it doesn't depend on Intl on the phone.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (iso, year = false) =>
  iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}${year ? `, ${iso.slice(0, 4)}` : ''}` : '';

// "20:00" -> "8:00 PM", or "20:00" with Settings › 24-hour time
let clock24 = !!prefs.load()?.clock24;
export const is24h = () => clock24;
export const set24h = (on) => { clock24 = on; prefs.save({ ...prefs.load(), clock24: on }); };
export function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  return clock24 ? `${h}:${mm}` : `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 14, ...soft.raised },
  section: { marginTop: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, minHeight: 28 },
  sectionTitle: { fontSize: 19, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  btn: { minHeight: 48, borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  big: { minHeight: 60, borderRadius: 20 },
  btnText: { fontSize: 16, fontWeight: '600' },
  bigText: { fontSize: 20, fontWeight: '700' },
  capsule: { flexDirection: 'row', borderRadius: 999, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.25)' },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  statusText: { fontSize: 13, fontWeight: '700' },
  avatar: { backgroundColor: colors.primaryWash, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primaryInk, fontWeight: '700' },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.missed, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  seg: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 16, padding: 4, ...soft.pressed },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.card, ...soft.raisedSm },
  segText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 6 },
  hint: { fontSize: 13, fontWeight: '400', color: colors.muted },
  input: { minHeight: 50, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line2, borderRadius: 14,
           paddingHorizontal: 14, fontSize: 17, color: colors.text, ...soft.pressed },
  group: { backgroundColor: colors.card, borderRadius: 22, overflow: 'hidden', ...soft.raised },
  rule: { borderTopWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primaryWash, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.muted },
  rowValue: { fontSize: 17, color: colors.text, marginTop: 1 },
  error: { color: colors.missed, backgroundColor: colors.missedWash, borderRadius: 14, padding: 12, fontSize: 15, marginVertical: 8 },
});
