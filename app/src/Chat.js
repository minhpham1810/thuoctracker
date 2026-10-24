import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, day, hhmm } from './api';
import { usePoll } from './hooks';
import { colors } from './ui';

const ROLE_LABEL = { patient: 'Patient', family: 'Family', doctor: 'Doctor' };

// One chat per patient: the patient, their family and their doctor.
export default function Chat({ user, patientId }) {
  const [tick, setTick] = useState(0); // bump to refetch right after sending
  const [messages] = usePoll(() => api.messages(patientId), [patientId, tick], 2000);
  const [text, setText] = useState('');
  const list = useRef(null);

  useEffect(() => { list.current?.scrollToEnd({ animated: true }); }, [messages?.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      await api.sendMessage(patientId, { sender: user.role, sender_name: user.name, text: t });
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
        ListEmptyComponent={<Text style={s.empty}>No messages yet. Say hello!</Text>}
        renderItem={({ item: m }) => {
          const mine = m.sender === user.role && m.sender_name === user.name;
          return (
            <View style={[s.bubble, mine ? s.mine : s.theirs]}>
              {!mine && <Text style={s.who}>{m.sender_name} · {ROLE_LABEL[m.sender]}</Text>}
              <Text style={[s.text, mine && { color: '#fff' }]}>{m.text}</Text>
              <Text style={[s.time, mine && { color: '#DCE7FF' }]}>{day(m.at)} {hhmm(m.at)}</Text>
            </View>
          );
        }}
      />
      <View style={s.bar}>
        <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Message"
                   onSubmitEditing={send} returnKeyType="send" />
        <Pressable onPress={send} style={s.send}><Text style={s.sendText}>Send</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: '80%', borderRadius: 14, padding: 10, marginVertical: 4 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  who: { fontSize: 12, fontWeight: '700', color: colors.muted, marginBottom: 2 },
  text: { fontSize: 16, color: colors.text },
  time: { fontSize: 11, color: colors.muted, marginTop: 4, alignSelf: 'flex-end' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40 },
  bar: { flexDirection: 'row', padding: 8, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  input: { flex: 1, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.bg, borderRadius: 20 },
  send: { justifyContent: 'center', paddingHorizontal: 16 },
  sendText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
});
