import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, getBaseUrl, setBaseUrl } from './api';
import { Button, colors, ErrorText, Field, Logo } from './ui';

// Email + password. The account's role decides what the app shows.
export default function Login({ onLogin, onSignUp, notice }) {
  const [url, setUrl] = useState(getBaseUrl());
  const [editUrl, setEditUrl] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  const changeUrl = (u) => { setUrl(u); setBaseUrl(u); }; // sign-up uses it too

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setError(null);
    setBusy(true);
    try {
      onLogin(await api.login(email, password));
    } catch (e) {
      setError(e.message === 'Wrong email or password' ? e.message
        : `Can't reach the server at ${url} (${e.message}). Is this phone on the same Wi-Fi or hotspot, and is the server running?`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={auth.wrap} keyboardShouldPersistTaps="handled">
      <Brand title="Welcome back" lede="Today's pills, alerts and messages for you and your family." />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
             autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
             textContentType="password" onSubmitEditing={submit} returnKeyType="go" />
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? 'Logging in…' : 'Log in'} onPress={submit} disabled={busy} big />
      <Pressable onPress={onSignUp} hitSlop={8} accessibilityRole="button" style={auth.linkBtn}>
        <Text style={auth.linkText}>New here? <Text style={auth.link}>Create an account</Text></Text>
      </Pressable>

      {/* The hotspot laptop's address changes, so it stays one tap away, out of the main flow */}
      <View style={auth.server}>
        {editUrl ? (
          <Field label="Server address" value={url} onChangeText={changeUrl} autoCapitalize="none" keyboardType="url"
                 onSubmitEditing={() => setEditUrl(false)} style={{ marginBottom: 0 }} />
        ) : (
          <Pressable onPress={() => setEditUrl(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Server ${url}. Change`}>
            <Text style={auth.serverText}>Server: {url.replace(/^https?:\/\//, '')}  <Text style={auth.link}>Change</Text></Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

export function Brand({ title, lede }) {
  return (
    <View style={auth.brand}>
      <View style={auth.mark}><Logo size={40} /><Text style={auth.word}>ThuocTracker</Text></View>
      <Text style={auth.title} accessibilityRole="header">{title}</Text>
      {lede ? <Text style={auth.lede}>{lede}</Text> : null}
    </View>
  );
}

export const auth = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 48, paddingBottom: 48 },
  brand: { marginBottom: 28 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 },
  word: { fontSize: 19, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.6 },
  lede: { fontSize: 16, lineHeight: 23, color: colors.muted, marginTop: 6 },
  linkBtn: { alignItems: 'center', paddingVertical: 18 },
  linkText: { fontSize: 16, color: colors.muted },
  link: { color: colors.primaryInk, fontWeight: '700' },
  server: { marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderColor: colors.line },
  serverText: { fontSize: 14, color: colors.muted, textAlign: 'center' },
});
