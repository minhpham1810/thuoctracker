import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, hhmm } from './api';
import { usePoll } from './hooks';
import { clock, colors, fmtDay, soft } from './ui';

// 1:1 chat with someone in the user's care circle. Fetching it marks their messages read.
export default function Chat({ user, other }) {
  const [tick, setTick] = useState(0); // bump to refetch right after sending
  const [messages] = usePoll(() => api.messages(other.id), [other.id, tick], 2000);
  const [text, setText] = useState('');
  const list = useRef(null);

  useEffect(() => { list.current?.scrollToEnd({ animated: true }); }, [messages?.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      await api.sendMessage(other.id, t);
      setTick((x) => x + 1);
    } catch {
      setText(t); // keep it so they can retry
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                          keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={messages || []}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={<Text style={s.empty}>No messages yet. Say hello to {other.name}.</Text>}
        renderItem={({ item: m }) => {
          const mine = m.from_id === user.id;
          return (
            <View style={[s.bubble, mine ? s.mine : s.theirs]}>
              <Text style={[s.text, mine && { color: '#fff' }]}>{m.text}</Text>
              <Text style={[s.time, mine && { color: 'rgba(255,255,255,0.8)' }]}>{fmtDay(m.at)}, {clock(hhmm(m.at))}</Text>
            </View>
          );
        }}
      />
      <View style={s.bar}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder={`Message ${other.name}`}
                   placeholderTextColor={colors.placeholder} onSubmitEditing={send} returnKeyType="send" multiline={false}
                   accessibilityLabel="Message" />
        <Pressable onPress={send} style={({ pressed }) => [s.send, !text.trim() && { opacity: 0.5 }, pressed && { opacity: 0.75 }]}
                   accessibilityRole="button" accessibilityLabel="Send">
          <Text style={s.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, marginVertical: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderBottomLeftRadius: 6, ...soft.raisedSm },
  text: { fontSize: 16, lineHeight: 22, color: colors.text },
  time: { fontSize: 12, color: colors.muted, marginTop: 4, alignSelf: 'flex-end' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, fontSize: 15 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: colors.bg },
  input: { flex: 1, minHeight: 46, fontSize: 16, paddingHorizontal: 16, backgroundColor: colors.bg, borderRadius: 23, color: colors.text, ...soft.pressed },
  send: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 23, backgroundColor: colors.primary, ...soft.raisedSm },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
