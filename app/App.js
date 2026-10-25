import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
import Profile from './src/Profile';
import { clearSession, loadSession, saveSession } from './src/session';
import Settings from './src/Settings';
import SignUp from './src/SignUp';
import { ask, Avatar, clock, colors, fmtDay, Logo } from './src/ui';

// iOS 26: the tab bar is teal-tinted liquid glass; elsewhere GlassView is a plain View, so it gets a solid teal fill
const GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

// Tab bar icon for each tab name
const ICON = {
  Today: 'pill', Visits: 'calendar-month-outline', Schedule: 'calendar-month-outline', 'Care team': 'account-group-outline',
  Patients: 'account-multiple-outline', Chat: 'chat-outline', Profile: 'account-circle-outline', Settings: 'cog-outline',
};

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
    const chat = <Chat key={other.id} user={user} other={other} />;
    body = user.role === 'doctor' && patientId
      // Today first: the doctor opens a patient to check doses or add a medicine; Chat is one tap away
      ? <Switcher key={`patient-${other.id}`} tabs={{ Today: <PatientView user={user} patientId={patientId} />, Chat: chat }} />
      : chat;
  } else if (user) {
    const people = <People user={user} onOpen={setOther} />;
    // patient and family: today's pills come first, like the cabinet; the care team is one tap away
    const visits = <Schedule user={user} />;
    // asked first: older users may not remember their password to log back in
    const confirmLogout = async () => {
      if (await ask('Log out?', 'You will need your email and password to log back in.', 'Log out', 'Cancel')) logout();
    };
    const me = { Profile: <Profile user={user} onLogout={confirmLogout} />, Settings: <Settings user={user} onLogout={confirmLogout} /> };
    // keys: each screen gets its own Switcher, so it opens on its first tab (not a tab left over from another screen)
    body = patientId
      ? <Switcher key="home" tabs={{ Today: <PatientView user={user} patientId={patientId} />, Visits: visits, 'Care team': people, ...me }} />
      : <Switcher key="home" tabs={{ Patients: people, Schedule: visits, ...me }} />;
  }
  const subtitle = other ? (other.role === 'patient' ? 'Patient' : other.role === 'family' ? 'Family' : 'Doctor')
    : user?.role === 'doctor' ? 'Your patients and their families' : user?.role === 'family' ? 'Family account' : 'Your medicine cabinet';

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen} edges={user ? ['bottom'] : ['top', 'bottom']}>
        {user && (
          <SafeAreaView edges={['top']} style={s.header}>
            {other ? (
              <Pressable onPress={() => setOther(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"
                style={s.back}>
                <Text style={s.backText}>‹</Text>
              </Pressable>
            ) : <Logo size={32} onColor />}
            {other && <Avatar name={other.name} size={36} />}
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">{other ? other.name : user.name}</Text>
              <Text style={s.headerSub} numberOfLines={1}>{subtitle}</Text>
            </View>
          </SafeAreaView>
        )}
        {user && <Watcher user={user} />}
        {user?.role === 'patient' && <PillCheck user={user} />}
        <View style={{ flex: 1 }}>{body}</View>
        <Banner />
        <StatusBar style={user ? 'light' : 'dark'} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Switcher({ tabs }) {
  const names = Object.keys(tabs);
  const [tab, setTab] = useState(names[0]);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{tabs[tab]}</View>
      <View style={s.navWrap}>
        <GlassView isInteractive tintColor={colors.primary} style={[s.nav, !GLASS && s.navSolid]} accessibilityRole="tablist">
          {names.map((name) => {
            const on = name === tab;
            return (
              <Pressable key={name} onPress={() => setTab(name)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={name} style={({ pressed }) => [s.navItem, on && s.navOn, pressed && !on && s.navPressed]}>
                <MaterialCommunityIcons name={ICON[name]} size={26} color={on ? colors.primaryInk : '#fff'} />
                <Text style={[s.navText, on && s.navTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                  maxFontSizeMultiplier={1.3}>{name}</Text>
              </Pressable>
            );
          })}
        </GlassView>
      </View>
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
  // Teal header bar: white text and outlined buttons
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
            backgroundColor: colors.primary },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  backText: { fontSize: 30, lineHeight: 32, color: '#fff', marginTop: -3 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 13, color: '#fff' },
  // Tab bar: a teal bar so it stands out from the page; the open tab is a white pill with a teal icon
  navWrap: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6, backgroundColor: colors.bg },
  nav: { flexDirection: 'row', gap: 2, padding: 4, borderRadius: 26 },
  navSolid: { backgroundColor: colors.primary, boxShadow: '0 6px 16px -6px rgba(29,48,46,0.5)' },
  navItem: { flex: 1, minHeight: 60, borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2 },
  navOn: { backgroundColor: '#fff' },
  navPressed: { backgroundColor: 'rgba(255,255,255,0.15)' },
  navText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  navTextOn: { color: colors.primaryInk },
  banner: { position: 'absolute', top: 64, left: 12, right: 12, flexDirection: 'row', gap: 12, backgroundColor: colors.text,
            borderRadius: 20, padding: 16, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12 },
  bannerMark: { width: 4, borderRadius: 2, backgroundColor: '#FBBF24' },
  bannerTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
  bannerBody: { color: colors.line, fontSize: 15, marginTop: 2, lineHeight: 21 },
});
