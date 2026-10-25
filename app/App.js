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
import PillCheck from './src/PillCheck';
import Schedule from './src/Schedule';
import People from './src/People';
import { clearSession, loadSession, saveSession } from './src/session';
import SignUp from './src/SignUp';
import { clock, colors, fmtDay, Logo, Tabs } from './src/ui';

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
    // patient and family: today's pills come first, like the cabinet; the care team is one tap away
    const visits = <Schedule user={user} />;
    body = patientId
      ? <Switcher tabs={{ Today: <PatientView user={user} patientId={patientId} />, Visits: visits, 'Care team': people }} />
      : <Switcher tabs={{ Patients: people, Schedule: visits }} />;
  }
  const subtitle = other ? (other.role === 'patient' ? 'Patient' : other.role === 'family' ? 'Family' : 'Doctor')
    : user?.role === 'doctor' ? 'Your patients and their families' : user?.role === 'family' ? 'Family account' : 'Your medicine cabinet';

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        {user && (
          <View style={s.header}>
            {other ? (
              <Pressable onPress={() => setOther(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"
                style={s.back}>
                <Text style={s.backText}>‹</Text>
              </Pressable>
            ) : <Logo size={32} />}
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">{other ? other.name : user.name}</Text>
              <Text style={s.headerSub} numberOfLines={1}>{subtitle}</Text>
            </View>
            {!other && (
              <Pressable onPress={() => logout()} hitSlop={12} accessibilityRole="button" style={s.headerBtn}>
                <Text style={s.headerBtnText}>Log out</Text>
              </Pressable>
            )}
          </View>
        )}
        {user && <Watcher user={user} />}
        {user?.role === 'patient' && <PillCheck user={user} />}
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
      <View style={s.tabsBar}><Tabs tabs={names} value={tab} onChange={setTab} /></View>
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
    <Pressable style={s.banner} onPress={() => setNote(null)} accessibilityRole="alert" accessibilityHint="Tap to dismiss">
      <View style={s.bannerMark} />
      <View style={{ flex: 1 }}>
        <Text style={s.bannerTitle}>{note.title}</Text>
        <Text style={s.bannerBody}>{note.body}</Text>
      </View>
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
  if (user.role === 'doctor') {
    for (const x of await api.schedule()) {
      if (x.patient_id) {
        out.push({ id: `b${x.id}-${x.patient_id}`, title: 'New appointment',
                   body: `${x.patient_name}, ${fmtDay(x.starts_at)} at ${clock(x.starts_at.slice(11, 16))}` });
      }
    }
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10,
            backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.line },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  backText: { fontSize: 30, lineHeight: 32, color: colors.primaryInk, marginTop: -3 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  headerSub: { fontSize: 13, color: colors.muted },
  headerBtn: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bg },
  headerBtnText: { color: colors.primaryInk, fontSize: 15, fontWeight: '600' },
  tabsBar: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.line },
  banner: { position: 'absolute', top: 64, left: 12, right: 12, flexDirection: 'row', gap: 12, backgroundColor: colors.text,
            borderRadius: 16, padding: 16, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12 },
  bannerMark: { width: 4, borderRadius: 2, backgroundColor: '#FBBF24' },
  bannerTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
  bannerBody: { color: '#DCE6E8', fontSize: 15, marginTop: 2, lineHeight: 21 },
});
