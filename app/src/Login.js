import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { api, getBaseUrl, setBaseUrl } from './api';
import { Button, colors, Title } from './ui';

// Email only, no password (demo). The account's role decides what the app shows.
export default function Login({ onLogin }) {
  const [url, setUrl] = useState(getBaseUrl());
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !email.trim()) return;
    setBaseUrl(url);
    setError(null);
    setBusy(true);
    try {
      onLogin(await api.login(email));
    } catch (e) {
      setError(e.message === 'No account with that email' ? e.message
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
                 keyboardType="email-address" placeholder="you@example.com" onSubmitEditing={submit} />
      <Button title={busy ? 'Logging in…' : 'Log in'} onPress={submit} />
      {error && <Text style={s.error}>{error}</Text>}
      <Title>Server</Title>
      <TextInput style={s.input} value={url} onChangeText={setUrl} autoCapitalize="none"
                 autoCorrect={false} keyboardType="url" />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 20, paddingTop: 40 },
  logo: { fontSize: 30, fontWeight: '800', color: colors.primary, marginBottom: 10 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10,
           padding: 12, fontSize: 16, marginBottom: 6 },
  error: { color: colors.missed, marginTop: 10, fontSize: 15 },
});
