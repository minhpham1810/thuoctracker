import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { api } from './api';
import { auth, Brand } from './Login';
import { Button, colors, ErrorText, Field, Tabs } from './ui';

const ROLES = { Patient: 'patient', Family: 'family', Doctor: 'doctor' };
const ABOUT = {
  Patient: 'You take the medicines in the cabinet.',
  Family: 'You look after someone who uses the cabinet. You get their alerts.',
  Doctor: 'You prescribe. Your patients link to you with your email.',
};

// Anyone can sign up. A patient links to their doctor, family to their patient, by that person's email.
export default function SignUp({ onLogin, onBack }) {
  const [role, setRole] = useState('Patient');
  const [f, setF] = useState({ name: '', email: '', password: '', age: '', doctor_email: '', patient_email: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const field = (k, label, props = {}) => (
    <Field label={label} value={f[k]} onChangeText={(v) => setF((x) => ({ ...x, [k]: v }))} autoCapitalize="none" {...props} />
  );

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = ROLES[role];
      onLogin(await api.signup({
        role: r, name: f.name, email: f.email, password: f.password,
        age: r === 'patient' ? Number(f.age) || null : null,
        doctor_email: r === 'patient' ? f.doctor_email : null,
        patient_email: r === 'family' ? f.patient_email : null,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={auth.wrap} keyboardShouldPersistTaps="handled">
      <Brand title="Create an account" />
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 8 }}>I am</Text>
      <Tabs tabs={Object.keys(ROLES)} value={role} onChange={setRole} />
      <Text style={{ fontSize: 15, color: colors.muted, marginTop: 10, marginBottom: 20, lineHeight: 21 }}>{ABOUT[role]}</Text>
      {field('name', 'Name', { autoCapitalize: 'words', autoComplete: 'name', placeholder: role === 'Family' ? 'e.g. Minh (grandson)' : '' })}
      {field('email', 'Email', { keyboardType: 'email-address', autoComplete: 'email' })}
      {field('password', 'Password', { secureTextEntry: true, autoComplete: 'new-password', hint: 'at least 6 characters' })}
      {role === 'Patient' && field('age', 'Age', { keyboardType: 'number-pad' })}
      {role === 'Patient' && field('doctor_email', "Your doctor's email", { keyboardType: 'email-address' })}
      {role === 'Family' && field('patient_email', "Their email", { keyboardType: 'email-address', hint: 'the person you look after' })}
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? 'Creating…' : 'Create account'} onPress={submit} disabled={busy} big />
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" style={auth.linkBtn}>
        <Text style={auth.linkText}>Already have an account? <Text style={auth.link}>Log in</Text></Text>
      </Pressable>
    </ScrollView>
  );
}
