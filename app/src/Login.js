import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, getBaseUrl, setBaseUrl } from './api';
import { Button, Card, colors, Title } from './ui';

const ROLES = [
  { role: 'patient', label: "I'm the patient", hint: 'See my pills and talk to my family and doctor' },
  { role: 'family', label: "I'm family", hint: 'Get alerts and check on my loved one' },
  { role: 'doctor', label: "I'm a doctor", hint: 'See all my patients and refill alerts' },
];

// No passwords for the hackathon: pick a role, then who you are.
export default function Login({ onLogin }) {
  const [url, setUrl] = useState(getBaseUrl());
  const [role, setRole] = useState(null);
  const [people, setPeople] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const pickRole = async (r) => {
    if (busy) return;
    setBaseUrl(url);
    setError(null);
    setBusy(true);
    try {
      setPeople(r === 'doctor' ? await api.doctors() : await api.patients());
      setRole(r);
    } catch (e) {
      setError(`Can't reach the backend at ${url} (${e.message}). Same hotspot? Server running? ` +
               `Try opening ${url}/health in the phone's browser.`);
    } finally {
      setBusy(false);
    }
  };

  const pickPerson = (p) => {
    if (role === 'doctor') onLogin({ role, id: p.id, name: p.name });
    else if (role === 'patient') onLogin({ role, id: p.id, name: p.name, patientId: p.id });
    else onLogin({ role, id: p.id, name: name.trim() || `${p.name}'s family`, patientId: p.id });
  };

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.logo}>ThuocTracker</Text>
      <Text style={s.tag}>The doctor writes the prescription. We close the loop.</Text>

      {!role && (
        <>
          <Title>Backend address</Title>
          <TextInput style={s.input} value={url} onChangeText={setUrl} autoCapitalize="none"
                     autoCorrect={false} keyboardType="url" />
          <Title>Who are you?</Title>
          {ROLES.map((r) => (
            <Card key={r.role}>
              <Button title={busy ? 'Connecting…' : r.label} onPress={() => pickRole(r.role)} big />
              <Text style={s.hint}>{r.hint}</Text>
            </Card>
          ))}
          {error && <Text style={s.error}>{error}</Text>}
        </>
      )}

      {role && (
        <>
          {role === 'family' && (
            <>
              <Title>Your name</Title>
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Minh (grandson)" />
            </>
          )}
          <Title>{role === 'doctor' ? 'Which doctor are you?' : role === 'family' ? 'Whose family are you?' : 'Which patient are you?'}</Title>
          {people.map((p) => (
            <Button key={p.id} title={p.name} kind="ghost" onPress={() => pickPerson(p)} />
          ))}
          <View style={{ height: 12 }} />
          <Button title="Back" kind="ghost" onPress={() => setRole(null)} />
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 40 },
  logo: { fontSize: 34, fontWeight: '800', color: colors.primary },
  tag: { fontSize: 15, color: colors.muted, marginTop: 4, marginBottom: 10 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
           padding: 12, fontSize: 16 },
  hint: { color: colors.muted, textAlign: 'center', marginTop: 4 },
  error: { color: colors.missed, marginTop: 10, fontSize: 15 },
});
