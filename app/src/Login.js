import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { api, getBaseUrl, setBaseUrl } from './api';
import { Button, colors, Title } from './ui';

// Email + password. The account's role decides what the app shows.
export default function Login({ onLogin, onSignUp, notice }) {
  const [url, setUrl] = useState(getBaseUrl());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  const changeUrl = (u) => { setUrl(u); setBaseUrl(u); }; // sign-up uses it too

  const submit = async () => {
    if (busy || !email.trim() || !password) return;
    setError(null);
    setBusy(true);
    try {
      onLogin(await api.login(email, password));
    } catch (e) {
      setError(e.message === 'Wrong email or password' ? e.message
        : `Can't reach the backend at ${url} (${e.message}). Same hotspot? Server running?`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Text style={s.logo}>ThuocTracker</Text>
      <Title>Email</Title>
      <TextInput style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
                 keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
      <Title>Password</Title>
      <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry
                 autoComplete="password" onSubmitEditing={submit} />
      <Button title={busy ? 'Logging in…' : 'Log in'} onPress={submit} />
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable onPress={onSignUp} hitSlop={8}>
        <Text style={s.link}>New here? Create an account</Text>
      </Pressable>
      <Title>Server</Title>
      <TextInput style={s.input} value={url} onChangeText={changeUrl} autoCapitalize="none"
                 autoCorrect={false} keyboardType="url" />
    </ScrollView>
  );
}

export const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 40 },
  logo: { fontSize: 30, fontWeight: '800', color: colors.primary, marginBottom: 10 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
           padding: 12, fontSize: 16, marginBottom: 6 },
  error: { color: colors.missed, marginTop: 10, fontSize: 15 },
  link: { color: colors.primary, fontSize: 16, fontWeight: '600', textAlign: 'center', marginVertical: 16 },
});
