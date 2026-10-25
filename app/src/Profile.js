import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { usePoll } from './hooks';
import { Avatar, Button, colors, Group, Row, Section } from './ui';

const ROLE = { patient: 'Patient', family: 'Family member', doctor: 'Doctor' };

// Who you are and who looks after you. Read-only: accounts are set up at sign-up.
export default function Profile({ user, onLogout }) {
  const [contacts] = usePoll(() => api.contacts(), [user.id], 15000);
  const people = (role) => contacts?.filter((c) => c.user.role === role).map((c) => c.user.name) ?? null;
  const list = (role) => { const p = people(role); return p === null ? 'Loading…' : p.join(', ') || 'None yet'; };
  const count = (role, one, many) => { const p = people(role); return p === null ? 'Loading…' : `${p.length} ${p.length === 1 ? one : many}`; };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={s.head}>
        <Avatar name={user.name} size={84} />
        <Text style={s.name} accessibilityRole="header">{user.name}</Text>
        <Text style={s.role}>{ROLE[user.role]}</Text>
      </View>

      <Section title="Account">
        <Group>
          <Row icon="email-outline" label="Email" value={user.email} />
          {user.role === 'patient' && <Row icon="cake-variant-outline" label="Age" value={`${user.age} years`} />}
        </Group>
      </Section>

      <Section title="Care circle">
        <Group>
          {user.role === 'family' && <Row icon="account-heart-outline" label="Caring for" value={list('patient')} />}
          {user.role !== 'doctor' && <Row icon="stethoscope" label="Doctor" value={list('doctor')} />}
          {user.role === 'patient' && <Row icon="account-group-outline" label="Family" value={list('family')} />}
          {user.role === 'doctor' && <Row icon="account-multiple-outline" label="Patients" value={count('patient', 'patient', 'patients')} />}
          {user.role === 'doctor' && <Row icon="account-group-outline" label="Families" value={count('family', 'family member', 'family members')} />}
        </Group>
      </Section>

      <Button title="Log out" kind="secondary" onPress={onLogout} style={{ marginTop: 28 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { alignItems: 'center', paddingTop: 12, gap: 4 },
  name: { marginTop: 10, fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: -0.3, textAlign: 'center' },
  role: { fontSize: 15, color: colors.muted },
});
