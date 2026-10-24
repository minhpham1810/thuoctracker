import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { usePoll } from './hooks';
import { Card, colors, Title } from './ui';
import { api } from './api';

const SECTIONS = [['doctor', 'Doctor'], ['patient', 'Patients'], ['family', 'Family']];

// Everyone assigned to this user. Tap someone to chat.
export default function People({ user, onOpen }) {
  const [people, error] = usePoll(() => api.contacts(user.id), [user.id], 10000);
  if (!people) return <Text style={s.muted}>{error ? `Can't reach the backend (${error})` : 'Loading…'}</Text>;
  const nameOf = Object.fromEntries(people.map((p) => [p.id, p.name]));
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {SECTIONS.map(([role, label]) => {
        const list = people.filter((p) => p.role === role);
        if (!list.length) return null;
        return [
          <Title key={role}>{label}</Title>,
          ...list.map((p) => (
            <Pressable key={p.id} onPress={() => onOpen(p)}>
              <Card>
                <Text style={s.name}>{p.name}</Text>
                {/* the doctor sees several families: say whose */}
                {role === 'family' && user.role === 'doctor' && (
                  <Text style={s.sub}>Family of {nameOf[p.patient_id]}</Text>
                )}
              </Card>
            </Pressable>
          )),
        ];
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  muted: { textAlign: 'center', marginTop: 40, color: colors.muted },
  name: { fontSize: 18, fontWeight: '600', color: colors.text },
  sub: { color: colors.muted, marginTop: 2 },
});
