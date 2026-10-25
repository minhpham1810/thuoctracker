import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, getBaseUrl, onUnauthorized, setBaseUrl, setToken } from './src/api';
import Chat from './src/Chat';
import { useNotifyNew, usePoll } from './src/hooks';
import Login from './src/Login';
import { onBanner, setupNotifications } from './src/notify';
import PatientView from './src/PatientView';
import People from './src/People';
import { clearSession, loadSession, saveSession } from './src/session';
import SignUp from './src/SignUp';
import { colors, Tabs } from './src/ui';

// Restore the last login before the first render, so the app opens where it was.
function restore() {
  const saved = loadSession();
  if (!saved) return null;
  setBaseUrl(saved.url);
  setToken(saved.token);
  return saved.user;
}

export default function App() {
  const [user, setUser] = useState(restore);
  const [other, setOther] = useState(null); // person being chatted with
  const [signingUp, setSigningUp] = useState(false);
  const [notice, setNotice] = useState(null); // shown on the login screen

  const login = (session) => {
    setToken(session.token);
    saveSession({ ...session, url: getBaseUrl() });
    setNotice(null);
    setSigningUp(false);
    setUser(session.user);
  };
  const logout = (message = null) => {
    if (message === null) api.logout().catch(() => {}); // a 401 means the session is already gone
    setToken(null);
    clearSession();
    setNotice(message);
    setOther(null);
    setUser(null);
  };

  useEffect(() => {
    onUnauthorized(() => logout('Please log in again.'));
    return () => onUnauthorized(null);
  }, []);
  // re-check a restored login (and pick up any change to the account)
  useEffect(() => { if (user) api.me().then(setUser).catch(() => {}); }, [user?.id]);
  useEffect(() => { if (user) setupNotifications(); }, [user?.id]);

  // the patient whose "Today" this user can see: their own, their family member's, or the one the doctor opened
  const patientId = user?.role === 'patient' ? user.id : user?.role === 'family' ? user.patient_id
    : other?.role === 'patient' ? other.id : null;

  let body = signingUp
    ? <SignUp onLogin={login} onBack={() => setSigningUp(false)} />
    : <Login onLogin={login} onSignUp={() => setSigningUp(true)} notice={notice} />;
  if (other) {
    const chat = <Chat user={user} other={other} />;
    body = user.role === 'doctor' && patientId
      // Today first: the doctor opens a patient to check doses or add a medicine; Chat is one tap away
      ? <Switcher tabs={{ Today: <PatientView user={user} patientId={patientId} />, Chat: chat }} />
      : chat;
  } else if (user) {
    const people = <People user={user} onOpen={setOther} />;
    body = patientId
      ? <Switcher tabs={{ People: people, Today: <PatientView user={user} patientId={patientId} /> }} />
      : people;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        {user && (
          <View style={s.header}>
            <Pressable onPress={other ? () => setOther(null) : () => logout()} hitSlop={12}>
              <Text style={s.headerBtn}>{other ? '‹ Back' : 'Log out'}</Text>
            </Pressable>
            <Text style={s.headerTitle} numberOfLines={1}>{other ? other.name : user.name}</Text>
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

function Switcher({ tabs }) {
  const names = Object.keys(tabs);
  const [tab, setTab] = useState(names[0]);
  return (
    <View style={{ flex: 1 }}>
      <Tabs tabs={names} value={tab} onChange={setTab} />
      {tabs[tab]}
    </View>
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
  const [contacts, alerts] = await Promise.all([api.contacts(), api.alerts()]);
  for (const { user: who, last } of contacts) {
    if (last && last.from_id === who.id) out.push({ id: `m${last.id}`, title: who.name, body: last.text });
  }
  for (const a of alerts) {
    if (a.to === user.role) out.push({ id: `a${a.id}`, title: 'ThuocTracker', body: a.message });
  }
  if (user.role === 'family') {
    const c = await api.cabinetState(user.patient_id);
    if (c.mode === 'take') {
      const who = contacts.find((x) => x.user.id === user.patient_id)?.user.name ?? 'Your family member';
      out.push({ id: `d${c.dose_id}`, title: 'Pill time', body: `Time for ${who}'s ${c.color} pill (${c.medicine}), slot ${c.slot}.` });
    }
  }
  if (user.role === 'patient') {
    const c = await api.cabinetState(user.id);
    if (c.mode === 'take') out.push({ id: `d${c.dose_id}`, title: 'Pill time', body: c.message });
    if (c.mode === 'missed') {
      out.push({ id: `x${c.dose_id}`, title: 'Missed pill', body: `You missed your ${c.medicine}. Your family and doctor have been told.` });
    }
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
