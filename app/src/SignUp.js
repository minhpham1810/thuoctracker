import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { api } from './api';
import { s } from './Login';
import { Button, Tabs, Title } from './ui';

const ROLES = { Patient: 'patient', Family: 'family', Doctor: 'doctor' };

// Anyone can sign up. A patient links to their doctor, family to their patient, by that person's email.
export default function SignUp({ onLogin, onBack }) {
  const [role, setRole] = useState('Patient');
  const [f, setF] = useState({ name: '', email: '', password: '', age: '', doctor_email: '', patient_email: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const field = (k, label, props = {}) => (
    <>
      <Title>{label}</Title>
      <TextInput style={s.input} value={f[k]} onChangeText={(v) => setF((x) => ({ ...x, [k]: v }))}
                 autoCapitalize="none" autoCorrect={false} {...props} />
    </>
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
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.logo}>Create an account</Text>
      <Tabs tabs={Object.keys(ROLES)} value={role} onChange={setRole} />
      {field('name', 'Name', { autoCapitalize: 'words', placeholder: role === 'Family' ? 'Minh (grandson)' : '' })}
      {field('email', 'Email', { keyboardType: 'email-address', autoComplete: 'email' })}
      {field('password', 'Password (6+ characters)', { secureTextEntry: true, autoComplete: 'new-password' })}
      {role === 'Patient' && field('age', 'Age', { keyboardType: 'number-pad' })}
      {role === 'Patient' && field('doctor_email', "Your doctor's email", { keyboardType: 'email-address' })}
      {role === 'Family' && field('patient_email', "The patient's email", { keyboardType: 'email-address' })}
      <Button title={busy ? 'Creating…' : 'Create account'} onPress={submit} />
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={s.link}>I have an account</Text>
      </Pressable>
    </ScrollView>
  );
}
