import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api } from './src/api';
import DoctorHome from './src/DoctorHome';
import { useNotifyNew, usePoll } from './src/hooks';
import Login from './src/Login';
import { onBanner, setupNotifications } from './src/notify';
import PatientView from './src/PatientView';
import { colors } from './src/ui';

export default function App() {
  const [user, setUser] = useState(null);
  const [openPatient, setOpenPatient] = useState(null); // doctor drilled into a patient

  useEffect(() => { if (user) setupNotifications(user.role, user.id); }, [user]);

  const logout = () => { setUser(null); setOpenPatient(null); };
  let title = 'ThuocTracker';
  let body = <Login onLogin={setUser} />;
  let back = null;
  if (user?.role === 'doctor' && openPatient) {
    title = openPatient.name;
    back = () => setOpenPatient(null);
    body = <PatientView user={user} patientId={openPatient.id} />;
  } else if (user?.role === 'doctor') {
    title = user.name;
    body = <DoctorHome user={user} onOpen={setOpenPatient} />;
  } else if (user) {
    title = user.role === 'patient' ? `Hi, ${user.name}` : `${user.name}`;
    body = <PatientView user={user} patientId={user.patientId} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        {user && (
          <View style={s.header}>
            <Pressable onPress={back || logout} hitSlop={12}>
              <Text style={s.headerBtn}>{back ? '‹ Back' : 'Log out'}</Text>
            </Pressable>
            <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
            <View style={{ width: 60 }} />
          </View>
        )}
        {user && <Watcher user={user} />}
        <View style={{ flex: 1 }}>{body}</View>
        <Banner />
        <StatusBar style="dark" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// In-app notification for phones where system notifications aren't available (Expo Go on Android).
function Banner() {
  const [note, setNote] = useState(null);
  useEffect(() => {
    let timer;
    onBanner((n) => { setNote(n); clearTimeout(timer); timer = setTimeout(() => setNote(null), 5000); });
    return () => { onBanner(null); clearTimeout(timer); };
  }, []);
  if (!note) return null;
  return (
    <Pressable style={s.banner} onPress={() => setNote(null)}>
      <Text style={s.bannerTitle}>{note.title}</Text>
      <Text style={s.bannerBody}>{note.body}</Text>
    </Pressable>
  );
}

// Polls everything this person should hear about and shows a phone notification for new
// items (skipped when real push works, since the backend pushes those itself).
function Watcher({ user }) {
  const [events] = usePoll(() => collectEvents(user), [user], 3000);
  useNotifyNew(events, (e) => e);
  return null;
}

async function collectEvents(user) {
  const out = [];
  const pids = user.role === 'doctor' ? (await api.patients(user.id)).map((p) => p.id) : [user.patientId];
  if (user.role !== 'patient') {
    const to = user.role === 'doctor' ? 'doctor' : 'family';
    for (const a of await api.alerts()) {
      if (a.to === to && pids.includes(a.patient_id)) out.push({ id: `a${a.id}`, title: 'ThuocTracker', body: a.message });
    }
  }
  for (const pid of pids) {
    for (const m of await api.messages(pid)) {
      if (m.sender === user.role && m.sender_name === user.name) continue;
      out.push({ id: `m${m.id}`, title: m.sender_name, body: m.text });
    }
  }
  if (user.role === 'patient') {
    const c = await api.cabinetState(user.patientId);
    if (c.mode === 'take') out.push({ id: `d${c.dose_id}`, title: 'Pill time', body: c.message });
  }
  return out;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
            paddingVertical: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.line },
  headerBtn: { color: colors.primary, fontSize: 16, width: 60 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text, flex: 1, textAlign: 'center' },
  banner: { position: 'absolute', top: 60, left: 12, right: 12, backgroundColor: colors.text, borderRadius: 14,
            padding: 14, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10 },
  bannerTitle: { color: '#fff', fontWeight: '800', fontSize: 15 },
  bannerBody: { color: '#E4E7EC', fontSize: 15, marginTop: 2 },
});
