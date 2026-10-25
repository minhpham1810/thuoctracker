import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { api, getBaseUrl } from './api';
import { usePoll } from './hooks';
import { notifyStatus, testNotify } from './notify';
import { colors, Group, is24h, Section, set24h } from './ui';

const NATIVE = Platform.OS !== 'web';
const NOTIFY = {
  push: 'On, even when the app is closed',
  local: 'On while the app is open',
  off: 'Off. Tap to turn them on in phone settings.',
  banner: 'Shown inside the app',
};
const TEXT_SIZE = Platform.select({
  ios: 'Set in Settings › Accessibility › Display & Text Size',
  android: 'Follows your phone. Tap to change it.',
  default: "Follows your browser's zoom",
});

// Only settings that really work: no switch here pretends to mute an alert the backend still pushes.
export default function Settings({ user, onLogout }) {
  const [check, setCheck] = useState(0); // bump to re-check the server now
  const [notify] = usePoll(() => notifyStatus(), [], 5000); // re-checked so a change in phone settings shows up
  const [health, offline] = usePoll(() => api.health(), [check], 5000);
  const [h24, setH24] = useState(is24h);
  const [tested, setTested] = useState(false);

  const toggle24 = (on) => { set24h(on); setH24(on); };
  const test = () => { testNotify(); setTested(true); };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Section title="Notifications" style={{ marginTop: 4 }}>
        <Group>
          <Item icon="bell-outline" title="Notifications" detail={notify ? NOTIFY[notify] : 'Checking…'}
            onPress={NATIVE ? () => Linking.openSettings() : undefined} />
          {notify && notify !== 'off' && (
            <Item icon="bell-ring-outline" title="Send a test notification"
              detail={tested ? 'Sent. It should appear in a moment.' : 'Check that alerts reach this phone'} onPress={test} />
          )}
        </Group>
        <Text style={s.footer}>Pill reminders and missed-dose alerts always come through while notifications are on.</Text>
      </Section>

      <Section title="Display">
        <Group>
          <Item icon="clock-outline" title="24-hour time" detail={h24 ? 'Times show as 20:00' : 'Times show as 8:00 PM'}
            right={<Switch value={h24} onValueChange={toggle24} accessibilityLabel="24-hour time"
              trackColor={{ false: colors.line2, true: colors.primary }} thumbColor="#fff" ios_backgroundColor={colors.line2}
              activeThumbColor="#fff" />} />
          <Item icon="format-size" title="Text size" detail={TEXT_SIZE}
            onPress={Platform.OS === 'android' ? () => Linking.sendIntent('android.settings.DISPLAY_SETTINGS') : undefined} />
        </Group>
      </Section>

      <Section title="Connection">
        <Group>
          <Item icon="server-network" title="Server" detail={getBaseUrl()} onPress={() => setCheck((x) => x + 1)}
            right={<Text style={[s.value, offline ? s.down : health && s.up]}>{offline ? 'Offline' : health ? 'Connected' : '…'}</Text>} />
        </Group>
        <Text style={s.footer}>Tap to check again. The server is the laptop running ThuocTracker.</Text>
      </Section>

      <Section title="Account">
        <Group>
          <Item icon="logout" title="Log out" detail={user.email} onPress={onLogout} danger />
        </Group>
      </Section>

      <Section title="About">
        <Group>
          <Item icon="information-outline" title="Version" right={<Text style={s.value}>{Constants.expoConfig?.version ?? '–'}</Text>} />
        </Group>
        <Text style={s.footer}>ThuocTracker reminds you and alerts your family. It never changes a dose: ask your doctor first.</Text>
      </Section>
    </ScrollView>
  );
}

// A settings row: icon tile, title, a detail line, then a value or switch (right) or a chevron when it opens something
function Item({ icon, title, detail, right, onPress, danger }) {
  const ink = danger ? colors.missed : colors.primaryInk;
  const body = (
    <>
      <View style={[s.icon, danger && { backgroundColor: colors.missedWash }]}>
        <MaterialCommunityIcons name={icon} size={21} color={ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.title, danger && { color: colors.missed }]}>{title}</Text>
        {detail ? <Text style={s.detail}>{detail}</Text> : null}
      </View>
      {right}
      {onPress && !right && !danger && <MaterialCommunityIcons name="chevron-right" size={24} color={colors.line2} />}
    </>
  );
  if (!onPress) return <View style={s.item}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={detail}
      style={({ pressed }) => [s.item, pressed && { backgroundColor: colors.bg }]}>
      {body}
    </Pressable>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryWash, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  detail: { fontSize: 14, color: colors.muted, marginTop: 2, lineHeight: 19 },
  value: { fontSize: 15, fontWeight: '600', color: colors.muted },
  up: { color: colors.taken },
  down: { color: colors.missed },
  footer: { marginTop: 8, paddingHorizontal: 6, fontSize: 13, lineHeight: 18, color: colors.muted },
});
