import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AddMedicine from './AddMedicine';
import { api, day, hhmm } from './api';
import { usePoll } from './hooks';
import { Button, Card, colors, Dot, Pill, statusColor, Title } from './ui';

// "Today" for one patient: pill-time banner, medicines, alerts (family only), dose history.
export default function PatientView({ user, patientId }) {
  const [tick, setTick] = useState(0); // bump to refetch right after "I took it"
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false); // scan-a-label form open
  const [data, error] = usePoll(async () => {
    const [meds, doses, alerts, cabinet] = await Promise.all([
      api.medicines(patientId), api.doses(patientId), api.alerts(), api.cabinetState(patientId)]);
    return { meds, doses, cabinet, alerts: alerts.filter((a) => a.patient_id === patientId).reverse() };
  }, [patientId, tick]);

  if (!data) return <Text style={s.loading}>{error ? `Can't reach the backend (${error})` : 'Loading…'}</Text>;
  if (adding) {
    return <AddMedicine patientId={patientId} meds={data.meds}
                        onDone={(saved) => { setAdding(false); if (saved) setTick((x) => x + 1); }} />;
  }
  const medName = Object.fromEntries(data.meds.map((m) => [m.id, m]));
  const big = user.role === 'patient';
  const myAlerts = data.alerts.filter((a) => user.role === 'doctor' ? a.to === 'doctor' : a.to === 'family');

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {data.cabinet.mode === 'take' && (
        <Card style={[s.banner, { borderColor: colors.pending }]}>
          <Text style={[s.bannerText, big && { fontSize: 26 }]}>💊 {data.cabinet.message}</Text>
          <Text style={s.muted}>Slot {data.cabinet.slot} is open on the cabinet</Text>
          {big && (
            <Button title={saving ? 'Saving…' : 'I took it'} big onPress={async () => {
              setSaving(true);
              await api.took(data.cabinet.dose_id).catch(() => {});
              setSaving(false);
              setTick((x) => x + 1);
            }} />
          )}
        </Card>
      )}
      {data.cabinet.mode === 'missed' && (
        <Card style={[s.banner, { borderColor: colors.missed }]}>
          <Text style={[s.bannerText, { color: colors.missed }]}>Missed: {data.cabinet.medicine}</Text>
        </Card>
      )}

      <Title>Medicines</Title>
      {(user.role === 'doctor' || user.role === 'family') && (
        <Button title="📷  Scan a label to add a medicine" kind="ghost" onPress={() => setAdding(true)} />
      )}
      {data.meds.map((m) => (
        <Card key={m.id} style={s.row}>
          <Dot color={m.color} />
          <View style={{ flex: 1 }}>
            <Text style={[s.name, big && { fontSize: 22 }]}>{m.name}</Text>
            <Text style={s.muted}>{m.dose} at {m.times.join(', ')} · slot {m.slot}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[s.left, m.pills_left < 5 && { color: colors.missed }]}>{m.pills_left} left</Text>
            <Text style={s.muted}>exp {m.expiration.slice(5).replace('-', '/')}</Text>
          </View>
        </Card>
      ))}

      {!big && (
        <>
          <Title>Alerts</Title>
          {myAlerts.length === 0 && <Text style={s.muted}>No alerts.</Text>}
          {myAlerts.slice(0, 10).map((a) => (
            <Card key={a.id} style={s.row}>
              <Text style={[s.alert, { flex: 1 }]}>{a.message}</Text>
              <Text style={s.muted}>{day(a.at)} {hhmm(a.at)}</Text>
            </Card>
          ))}
        </>
      )}

      <Title>Dose history</Title>
      {data.doses.length === 0 && <Text style={s.muted}>No doses yet.</Text>}
      {data.doses.slice(0, 15).map((d) => (
        <Card key={d.id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{medName[d.medicine_id]?.name ?? 'Medicine'}</Text>
            <Text style={s.muted}>
              due {day(d.due_at)} {hhmm(d.due_at)}
              {d.taken_at ? ` · taken ${hhmm(d.taken_at)} (${d.method === 'camera' ? 'camera' : 'screen tap'})` : ''}
            </Text>
          </View>
          <Pill text={d.status} color={statusColor(d.status)} />
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  loading: { textAlign: 'center', marginTop: 40, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  left: { fontSize: 16, fontWeight: '700', color: colors.text },
  alert: { fontSize: 15, color: colors.text },
  banner: { borderWidth: 2 },
  bannerText: { fontSize: 20, fontWeight: '800', color: colors.text },
});
