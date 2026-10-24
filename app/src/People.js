import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { usePoll } from './hooks';
import { Card, colors, Pill, Title } from './ui';

const SECTIONS = [['doctor', 'Doctor'], ['patient', 'Patients'], ['family', 'Family']];

// Everyone in this user's care circle. Tap someone to chat.
export default function People({ user, onOpen }) {
  const [contacts, error] = usePoll(() => api.contacts(), [user.id], 3000);
  if (!contacts) return <Text style={s.muted}>{error ? `Can't reach the backend (${error})` : 'Loading…'}</Text>;
  const nameOf = Object.fromEntries(contacts.map((c) => [c.user.id, c.user.name]));
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {!contacts.length && <Text style={s.muted}>No one in your care circle yet.</Text>}
      {SECTIONS.map(([role, label]) => {
        const list = contacts.filter((c) => c.user.role === role);
        if (!list.length) return null;
        return (
          <View key={role}>
            <Title>{label}</Title>
            {list.map(({ user: p, unread, last }) => (
              <Pressable key={p.id} onPress={() => onOpen(p)}>
                <Card style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{p.name}</Text>
                    {/* the doctor sees several families: say whose */}
                    {role === 'family' && user.role === 'doctor' && <Text style={s.sub}>Family of {nameOf[p.patient_id]}</Text>}
                    {last && (
                      <Text style={s.sub} numberOfLines={1}>{last.from_id === user.id ? 'You: ' : ''}{last.text}</Text>
                    )}
                  </View>
                  {unread > 0 && <Pill text={String(unread)} color={colors.missed} />}
                </Card>
              </Pressable>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  muted: { textAlign: 'center', marginTop: 40, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 18, fontWeight: '600', color: colors.text },
  sub: { color: colors.muted, marginTop: 2 },
});
