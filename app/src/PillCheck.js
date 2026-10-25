import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { usePoll } from './hooks';
import { Button, Capsule, clock, colors } from './ui';

const ASK_AGAIN_MS = 30 * 60 * 1000; // "Not yet": ask again in 30 minutes
const ASK_FOR_MS = 3 * 60 * 60 * 1000; // stop asking 3 h after the pill's time: never a nudge toward a late double dose

// The patient's "Did you take your pills?" popup. Every dose that's due and not confirmed gets Yes / Not yet; a new
// pill joins the same list. It only asks: it never says "take it now". Snoozes and dismissals live on this phone.
export default function PillCheck({ user }) {
  const [tick, setTick] = useState(0); // bump to refetch right after an answer
  const [data] = usePoll(async () => {
    const [meds, doses] = await Promise.all([api.medicines(user.id), api.doses(user.id)]);
    return { meds, doses };
  }, [user.id, tick], 10000);
  const [later, setLater] = useState({}); // dose id -> time to ask again
  const [done, setDone] = useState({}); // dose id -> answered Yes or dismissed (don't ask again)
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { // re-check every 30 s so a 30-minute "Not yet" comes back on time
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  if (!data) return null;
  const med = (id) => data.meds.find((m) => m.id === id);
  const ask = data.doses
    .filter((d) => (d.status === 'pending' || d.status === 'missed') && !done[d.id] && (later[d.id] ?? 0) <= now)
    .filter((d) => { const due = localTime(d.due_at); return due <= now && now - due < ASK_FOR_MS; })
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  if (!ask.length) return null;

  const yes = async (d) => {
    setBusy(d.id);
    setError(null);
    try {
      await api.took(d.id);
      setDone((x) => ({ ...x, [d.id]: true }));
      setTick((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const notYet = (d) => setLater((x) => ({ ...x, [d.id]: Date.now() + ASK_AGAIN_MS }));
  const dismissAll = () => setDone((x) => ({ ...x, ...Object.fromEntries(ask.map((d) => [d.id, true])) }));

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismissAll}>
      <View style={s.backdrop}>
        <View style={s.sheet} accessibilityViewIsModal>
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">
              {ask.length === 1 ? 'Did you take your pill?' : `Did you take your ${ask.length} pills?`}
            </Text>
            <Pressable onPress={dismissAll} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss, don't ask again"
              style={s.close}>
              <Text style={s.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 420 }}>
            {ask.map((d, i) => {
              const m = med(d.medicine_id);
              return (
                <View key={d.id} style={[s.item, i > 0 && s.rule]}>
                  <View style={s.itemTop}>
                    <Capsule color={m?.color} size={1.4} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{m?.name ?? 'Your pill'}</Text>
                      <Text style={s.meta}>
                        {[`${m?.dose ?? 'Pill'} at ${clock(d.due_at.slice(11, 16))}`, m?.slot && `box ${m.slot}`].filter(Boolean).join(', ')}
                      </Text>
                      {d.status === 'missed' && (
                        <Text style={s.missed}>Marked as missed. If you did take it, tap Yes.</Text>
                      )}
                    </View>
                  </View>
                  <View style={s.answers}>
                    <Button title={busy === d.id ? 'Saving…' : 'Yes, I took it'} kind="done" onPress={() => yes(d)}
                            disabled={busy !== null} style={{ flex: 1 }} />
                    <Button title="Not yet" kind="secondary" onPress={() => notYet(d)} disabled={busy !== null} style={{ flex: 1 }} />
                  </View>
                </View>
              );
            })}
          </ScrollView>
          {error && <Text style={s.error}>{error}</Text>}
          <Text style={s.foot}>"Not yet" asks again in 30 minutes. ✕ stops asking about these pills.</Text>
        </View>
      </View>
    </Modal>
  );
}

// Backend times are naive local ISO strings: without a "Z" they're read as local time
const localTime = (iso) => new Date(iso.slice(0, 19)).getTime();

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(18,40,46,0.55)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: colors.card, borderRadius: 22, padding: 20, maxHeight: '90%' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 6 },
  title: { flex: 1, fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  closeText: { fontSize: 18, color: colors.muted, fontWeight: '700' },
  item: { paddingVertical: 14 },
  rule: { borderTopWidth: 1, borderColor: colors.line },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  meta: { fontSize: 17, color: colors.muted, marginTop: 2 },
  missed: { fontSize: 15, color: colors.pending, marginTop: 4, fontWeight: '600' },
  answers: { flexDirection: 'row', gap: 10, marginTop: 12 },
  error: { color: colors.missed, fontSize: 15, marginTop: 8 },
  foot: { color: colors.muted, fontSize: 14, marginTop: 10, lineHeight: 20 },
});
