import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { usePoll } from './hooks';
import { Card, colors, Pill } from './ui';

// All of this doctor's patients with what needs attention.
export default function DoctorHome({ user, onOpen }) {
  const [rows, error] = usePoll(async () => {
    const patients = await api.patients(user.id);
    return Promise.all(patients.map(async (p) => {
      const [meds, doses] = await Promise.all([api.medicines(p.id), api.doses(p.id)]);
      return {
        p,
        missed: doses.filter((d) => d.status === 'missed').length,
        taken: doses.filter((d) => d.status === 'taken').length,
        low: meds.filter((m) => m.pills_left < 5).map((m) => m.name),
      };
    }));
  }, [user.id], 4000);

  if (!rows) return <Text style={s.loading}>{error ? `Can't reach the backend (${error})` : 'Loading…'}</Text>;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={s.count}>{rows.length} patients</Text>
      {rows.map(({ p, missed, taken, low }) => (
        <Pressable key={p.id} onPress={() => onOpen(p)}>
          <Card>
            <View style={s.head}>
              <Text style={s.name}>{p.name}</Text>
              <Text style={s.muted}>age {p.age}</Text>
            </View>
            <View style={s.badges}>
              <Pill text={`${taken} taken`} color={colors.taken} />
              {missed > 0 && <Pill text={`${missed} missed`} color={colors.missed} />}
              {low.length > 0 && <Pill text={`Refill: ${low.join(', ')}`} color={colors.pending} />}
            </View>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  loading: { textAlign: 'center', marginTop: 40, color: colors.muted },
  count: { color: colors.muted, marginBottom: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
});
