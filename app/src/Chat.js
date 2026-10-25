import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, hhmm } from './api';
import { usePoll } from './hooks';
import { Avatar, clock, colors, fmtDay, soft } from './ui';

const HEADER = 64; // App.js header height below the status bar, for the keyboard offset
const GAP_MIN = 15; // a pause this long starts a new group with a time label

// Backend times are local and naive ("2026-10-24T15:01:50.9"): compare by slicing, not new Date()
const minutes = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +iso.slice(11, 13), +iso.slice(14, 16)) / 60000;
const localNow = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 23); };
function dayLabel(iso) {
  const today = localNow().slice(0, 10);
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const day = iso.slice(0, 10);
  return day === today ? 'Today' : day === yesterday ? 'Yesterday' : fmtDay(iso, day.slice(0, 4) !== today.slice(0, 4));
}

// Messenger-style layout: a time label after a pause or a new day; bubbles from one sender in a row join up
const breakBefore = (a, b) => !a || a.at.slice(0, 10) !== b.at.slice(0, 10) || minutes(b.at) - minutes(a.at) >= GAP_MIN;
export function layout(items) {
  return items.map((m, i) => {
    const prev = items[i - 1], next = items[i + 1];
    const newDay = !prev || prev.at.slice(0, 10) !== m.at.slice(0, 10);
    const sep = breakBefore(prev, m) ? `${newDay ? `${dayLabel(m.at)}, ` : ''}${clock(hhmm(m.at))}` : null;
    return {
      ...m, sep,
      joinPrev: !sep && prev?.from_id === m.from_id,
      joinNext: !!next && next.from_id === m.from_id && !breakBefore(m, next),
    };
  });
}

// 1:1 chat with someone in the user's care circle. Fetching it marks their messages read.
export default function Chat({ user, other }) {
  const [tick, setTick] = useState(0); // bump to refetch right after sending
  const [messages, error] = usePoll(() => api.messages(other.id), [other.id, tick], 2000);
  const [outbox, setOutbox] = useState([]); // sent from here, shown at once: {key, text, at, id?, failed?}
  const [text, setText] = useState('');
  const [opened, setOpened] = useState(null); // bubble tapped to show its time
  const insets = useSafeAreaInsets();

  const send = async (t, key = `o${Date.now()}`) => {
    setOutbox((o) => [...o.filter((x) => x.key !== key), { key, text: t, at: localNow() }]);
    try {
      const m = await api.sendMessage(other.id, t);
      setOutbox((o) => o.map((x) => (x.key === key ? { ...x, id: m.id } : x)));
      setTick((x) => x + 1);
    } catch {
      setOutbox((o) => o.map((x) => (x.key === key ? { ...x, failed: true } : x)));
    }
  };
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    send(t);
  };

  if (!messages) {
    return <Text style={s.center}>{error ? `Can't reach the server (${error}). Retrying…` : 'Loading…'}</Text>;
  }
  const ids = new Set(messages.map((m) => m.id));
  const items = layout([
    ...messages.map((m) => ({ ...m, key: String(m.id) })),
    ...outbox.filter((x) => !ids.has(x.id)).map((x) => ({ ...x, from_id: user.id, sending: !x.id && !x.failed })),
  ]);
  const last = items[items.length - 1];

  const renderItem = ({ item: m }) => {
    const mine = m.from_id === user.id;
    const near = mine ? 'Right' : 'Left'; // the side the bubbles hang from
    const corners = { [`borderTop${near}Radius`]: m.joinPrev ? 6 : 20, [`borderBottom${near}Radius`]: m.joinNext ? 6 : 20 };
    // under my newest message only, like Messenger; a failed one gets the retry row instead
    const status = m.sending ? 'Sending…'
      : mine && !m.failed && m === last ? (m.read_at ? `Seen ${clock(hhmm(m.read_at))}` : 'Sent') : null;
    return (
      <View>
        {m.sep && <Text style={s.sep}>{m.sep}</Text>}
        <View style={[s.row, mine && s.rowMine, { marginTop: m.joinPrev ? 2 : 10 }]}>
          {!mine && (m.joinNext ? <View style={s.avatarGap} /> : <Avatar name={other.name} size={30} />)}
          <Pressable onPress={() => setOpened(opened === m.key ? null : m.key)} accessibilityRole="text"
            accessibilityLabel={`${mine ? 'You' : other.name}: ${m.text}. ${clock(hhmm(m.at))}`}
            style={[s.bubble, mine ? s.mine : s.theirs, corners, (m.sending || m.failed) && { opacity: 0.6 }]}>
            <Text style={[s.text, mine && s.textMine]} selectable>{m.text}</Text>
          </Pressable>
        </View>
        {opened === m.key && <Text style={[s.meta, mine ? s.metaMine : s.metaTheirs]}>{dayLabel(m.at)}, {clock(hhmm(m.at))}</Text>}
        {status && <Text style={[s.meta, s.metaMine]}>{status}</Text>}
        {m.failed && (
          <Pressable onPress={() => send(m.text, m.key)} accessibilityRole="button" style={s.retry}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.missed} />
            <Text style={s.retryText}>Not sent. Tap to try again.</Text>
          </Pressable>
        )}
      </View>
    );
  };

  const canSend = !!text.trim();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + HEADER}>
      {items.length ? (
        // inverted: newest at the bottom and the list stays pinned there as messages arrive
        <FlatList inverted data={[...items].reverse()} keyExtractor={(m) => m.key} renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }} keyboardShouldPersistTaps="handled" />
      ) : (
        <View style={s.empty}>
          <Avatar name={other.name} size={72} />
          <Text style={s.emptyName}>{other.name}</Text>
          <Text style={s.emptyHint}>No messages yet. Say hello.</Text>
        </View>
      )}
      <View style={s.bar}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder={`Message ${other.name}`}
          placeholderTextColor={colors.placeholder} multiline maxLength={2000} accessibilityLabel="Message"
          numberOfLines={Platform.OS === 'web' ? 1 : undefined} // a browser textarea starts at 2 rows; phones grow on their own
          // browser: Enter sends, Shift+Enter is a new line (phones use the send button)
          onKeyPress={(e) => {
            if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault(); submit(); }
          }} />
        <Pressable onPress={submit} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => [s.send, !canSend && s.sendOff, pressed && { opacity: 0.8 }]}>
          <MaterialCommunityIcons name="send" size={22} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: { textAlign: 'center', marginTop: 40, paddingHorizontal: 24, color: colors.muted, fontSize: 15, lineHeight: 22 },
  sep: { alignSelf: 'center', marginTop: 18, marginBottom: 4, color: colors.muted, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowMine: { justifyContent: 'flex-end' },
  avatarGap: { width: 30 },
  bubble: { maxWidth: '78%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  mine: { backgroundColor: colors.primary },
  theirs: { backgroundColor: colors.card, ...soft.raisedSm },
  text: { fontSize: 17, lineHeight: 23, color: colors.text },
  textMine: { color: '#fff' },
  meta: { marginTop: 4, color: colors.muted, fontSize: 12, fontWeight: '600' },
  metaMine: { alignSelf: 'flex-end', marginRight: 4 },
  metaTheirs: { marginLeft: 42 },
  retry: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, minHeight: 32, paddingHorizontal: 4 },
  retryText: { color: colors.missed, fontSize: 13, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 24 },
  emptyName: { marginTop: 8, fontSize: 20, fontWeight: '700', color: colors.text },
  emptyHint: { fontSize: 15, color: colors.muted },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 8,
         backgroundColor: colors.bg, borderTopWidth: 1, borderColor: colors.line },
  input: { flex: 1, minHeight: 46, maxHeight: 130, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 17,
           lineHeight: 22, color: colors.text, backgroundColor: colors.card, borderRadius: 23, ...soft.raisedSm },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  sendOff: { backgroundColor: colors.line2 },
});
