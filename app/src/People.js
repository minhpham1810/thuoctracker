import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, hhmm } from './api';
import { usePoll } from './hooks';
import { Avatar, Badge, clock, colors, fmtDay, Section } from './ui';

const SECTIONS = [['doctor', 'Doctor'], ['patient', 'Patients'], ['family', 'Family']];

// Everyone in this user's care circle. Tap someone to chat (the doctor also sees a patient's day).
export default function People({ user, onOpen }) {
  const [contacts, error] = usePoll(() => api.contacts(), [user.id], 3000);
  if (!contacts) {
    return <Text style={s.center}>{error ? `Can't reach the server (${error}). Retrying…` : 'Loading…'}</Text>;
  }
  const nameOf = Object.fromEntries(contacts.map((c) => [c.user.id, c.user.name]));
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {!contacts.length && (
        <Text style={s.center}>
          No one in your care circle yet.{user.role === 'doctor' ? ' Patients appear here when they sign up with your email.' : ''}
        </Text>
      )}
      {SECTIONS.map(([role, label], i) => {
        const list = contacts.filter((c) => c.user.role === role);
        if (!list.length) return null;
        return (
          <Section key={role} title={label} style={i === 0 && { marginTop: 4 }}>
            <View style={s.list}>
              {list.map(({ user: p, unread, last }, j) => {
                // the doctor sees several families: say whose
                const who = role === 'family' && user.role === 'doctor' ? `Family of ${nameOf[p.patient_id]}` : null;
                const preview = last ? `${last.from_id === user.id ? 'You: ' : ''}${last.text}` : 'No messages yet';
                return (
                  <Pressable key={p.id} onPress={() => onOpen(p)} accessibilityRole="button"
                    accessibilityLabel={`${p.name}${unread ? `, ${unread} unread` : ''}`}
                    style={({ pressed }) => [s.row, j > 0 && s.rule, pressed && { backgroundColor: colors.bg }]}>
                    <Avatar name={p.name} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{p.name}</Text>
                      {who && <Text style={s.sub}>{who}</Text>}
                      <Text style={[s.sub, unread > 0 && s.unread]} numberOfLines={1}>{preview}</Text>
                    </View>
                    <View style={s.end}>
                      {last && <Text style={s.when}>{fmtDay(last.at)}, {clock(hhmm(last.at))}</Text>}
                      {unread > 0 ? <Badge count={unread} /> : <Text style={s.chev}>›</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { textAlign: 'center', marginTop: 40, paddingHorizontal: 24, color: colors.muted, fontSize: 15, lineHeight: 22 },
  list: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 68 },
  rule: { borderTopWidth: 1, borderColor: colors.line },
  name: { fontSize: 17, fontWeight: '600', color: colors.text },
  sub: { color: colors.muted, fontSize: 14, marginTop: 1 },
  unread: { color: colors.text, fontWeight: '600' },
  end: { alignItems: 'flex-end', gap: 6 },
  when: { color: colors.muted, fontSize: 12 },
  chev: { color: colors.line2, fontSize: 26, lineHeight: 26 },
});
