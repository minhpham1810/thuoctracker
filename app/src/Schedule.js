import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { usePoll } from './hooks';
import { ask, Button, Card, clock, colors, ErrorText, Field, fmtDay, Section } from './ui';

const LENGTHS = [15, 30, 60]; // minutes per visit
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Appointments. Doctor: open times and who booked them. Patient and family: their visits, and booking a new one.
export default function Schedule({ user }) {
  const [tick, setTick] = useState(0); // bump to refetch right after a change
  const [slots, error] = usePoll(() => api.schedule(), [tick], 5000);
  const refresh = () => setTick((x) => x + 1);
  if (!slots) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>{error ? `Can't reach the server (${error}). Retrying…` : 'Loading…'}</Text>
      </View>
    );
  }
  return user.role === 'doctor'
    ? <DoctorSchedule slots={slots} refresh={refresh} />
    : <PatientSchedule user={user} slots={slots} refresh={refresh} />;
}

function DoctorSchedule({ slots, refresh }) {
  const days = nextDays(14);
  const [day, setDay] = useState(days[1]); // tomorrow: the usual case
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('12:00');
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const open = async () => {
    setError(null);
    setNote(null);
    if (!HHMM.test(start) || !HHMM.test(end)) return setError('Times must look like 09:00 (24-hour).');
    setBusy(true);
    try {
      const r = await api.addAvailability({ day, start, end, minutes });
      const n = r.added.length;
      setNote(n
        ? `Opened ${n} ${n === 1 ? 'time' : 'times'} ${dayName(day).toLowerCase() === 'today' ? 'today' : `on ${dayName(day)}`}.`
          + (r.skipped ? ` ${r.skipped} skipped: already in your schedule or already passed.` : '')
        : 'Nothing new: those times are already in your schedule or have passed.');
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (x) => {
    setError(null);
    if (x.patient_id && !(await ask('Cancel this visit?',
      `${x.patient_name} booked ${clock(hm(x.starts_at))}, ${dayName(ymd(x.starts_at))}. They and their family will be told.`,
      'Cancel visit'))) return;
    try {
      await api.removeSlot(x.id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const booked = slots.filter((x) => x.patient_id).length;
  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <View style={s.summary}>
        <Text style={s.summaryTitle}>{booked} booked, {slots.length - booked} open</Text>
        <Text style={s.muted}>Your appointments for the next two weeks</Text>
      </View>

      <Section title="Open new times">
        <Card>
          <Text style={s.label}>Day</Text>
          <DayChips days={days} value={day} onChange={setDay} />
          <View style={s.pair}>
            <Field label="From" value={start} onChangeText={setStart} placeholder="09:00" style={{ flex: 1 }} />
            <Field label="To" value={end} onChangeText={setEnd} placeholder="12:00" style={{ flex: 1 }} />
          </View>
          <Text style={s.label}>Each visit</Text>
          <View style={s.chips}>
            {LENGTHS.map((n) => <Chip key={n} on={minutes === n} onPress={() => setMinutes(n)} text={`${n} min`} />)}
          </View>
          <ErrorText>{error}</ErrorText>
          {note && <Text style={s.note}>{note}</Text>}
          <Button title={busy ? 'Opening…' : 'Open these times'} onPress={open} disabled={busy} style={{ marginTop: 12 }} />
        </Card>
      </Section>

      <Section title="Your schedule">
        {slots.length === 0 && <Text style={s.muted}>No times yet. Open some above so patients can book.</Text>}
        {byDay(slots).map(([d, list]) => (
          <View key={d} style={{ marginBottom: 12 }}>
            <Text style={s.dayHead}>{dayName(d)}</Text>
            <Card style={{ paddingVertical: 4 }}>
              {list.map((x, i) => (
                <View key={x.id} style={[s.row, i > 0 && s.rule]}>
                  <Text style={s.time}>{clock(hm(x.starts_at))}</Text>
                  <View style={{ flex: 1 }}>
                    {x.patient_id
                      ? <Text style={s.name}>{x.patient_name}</Text>
                      : <Text style={s.open}>Open</Text>}
                    {x.reason ? <Text style={s.body}>{x.reason}</Text> : null}
                    <Text style={s.muted}>{x.minutes} min, until {clock(endOf(x))}</Text>
                  </View>
                  <Pressable onPress={() => remove(x)} hitSlop={8} accessibilityRole="button" style={s.small}
                    accessibilityLabel={x.patient_id ? `Cancel ${x.patient_name}'s visit` : `Remove the open time ${clock(hm(x.starts_at))}`}>
                    <Text style={s.smallText}>{x.patient_id ? 'Cancel' : 'Remove'}</Text>
                  </Pressable>
                </View>
              ))}
            </Card>
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}

function PatientSchedule({ user, slots, refresh }) {
  const pid = user.role === 'patient' ? user.id : user.patient_id;
  const big = user.role === 'patient'; // bigger text for the patient, like Today
  const [day, setDay] = useState(null);
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const mine = slots.filter((x) => x.patient_id === pid);
  const open = slots.filter((x) => !x.patient_id);
  const doctor = slots[0]?.doctor_name ?? 'your doctor';
  const openDays = byDay(open);
  const shownDay = openDays.some(([d]) => d === day) ? day : openDays[0]?.[0];
  const times = openDays.find(([d]) => d === shownDay)?.[1] ?? [];
  const chosen = pick && open.some((x) => x.id === pick.id) ? pick : null; // gone if someone else just took it
  const label = (x) => `${dayName(ymd(x.starts_at))} at ${clock(hm(x.starts_at))}`;

  const book = async () => {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await api.book(chosen.id, { patient_id: pid, reason: reason.trim() || null });
      setNote(`Booked: ${label(chosen)} with ${chosen.doctor_name}.`);
      setPick(null);
      setReason('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const cancel = async (x) => {
    setError(null);
    setNote(null);
    if (!(await ask('Cancel this visit?', `${label(x)} with ${x.doctor_name}.`, 'Cancel visit'))) return;
    try {
      await api.cancelBooking(x.id);
      setNote(`Cancelled ${label(x)}.`);
    } catch (e) {
      setError(e.message);
    }
    refresh();
  };

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Section title={user.role === 'patient' ? 'Your visits' : 'Visits'} style={{ marginTop: 0 }}>
        {mine.length === 0 && <Text style={[s.muted, big && s.bodyBig]}>No visits booked.</Text>}
        {mine.map((x) => (
          <Card key={x.id} style={s.visit}>
            <Text style={[s.visitWhen, big && s.visitWhenBig]}>{label(x)}</Text>
            <Text style={[s.body, big && s.bodyBig]}>With {x.doctor_name}{x.reason ? `: ${x.reason}` : ''}</Text>
            {x.starts_at > nowIso() && (
              <Button title="Cancel visit" kind="secondary" onPress={() => cancel(x)} style={{ marginTop: 12 }} />
            )}
          </Card>
        ))}
      </Section>

      <Section title={`Book a visit with ${doctor}`}>
        {open.length === 0 ? (
          <Text style={[s.muted, big && s.bodyBig]}>No open times in the next two weeks. You can ask {doctor} in the chat.</Text>
        ) : (
          <>
            <Text style={s.label}>Day</Text>
            <DayChips days={openDays.map(([d]) => d)} value={shownDay} big={big}
                      onChange={(d) => { setDay(d); setPick(null); }} />
            <Text style={[s.label, { marginTop: 14 }]}>Time</Text>
            <View style={s.chips}>
              {times.map((x) => (
                <Chip key={x.id} big={big} on={chosen?.id === x.id} onPress={() => setPick(x)} text={clock(hm(x.starts_at))} />
              ))}
            </View>
            {chosen && (
              <Card style={{ marginTop: 14 }}>
                <Field label="Reason for the visit" hint="optional" value={reason} onChangeText={setReason}
                       placeholder="e.g. Blood pressure check" maxLength={300} />
                <Button title={busy ? 'Booking…' : `Book ${label(chosen)}`} big={big} onPress={book} disabled={busy} />
              </Card>
            )}
          </>
        )}
        <ErrorText>{error}</ErrorText>
        {note && <Text style={[s.note, big && s.bodyBig]}>{note}</Text>}
      </Section>
    </ScrollView>
  );
}

function DayChips({ days, value, onChange, big }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {days.map((d) => <Chip key={d} big={big} on={value === d} onPress={() => onChange(d)} text={shortDay(d)} />)}
    </ScrollView>
  );
}

function Chip({ text, on, onPress, big }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}
      style={[s.chip, big && s.chipBig, on && s.chipOn]}>
      <Text style={[s.chipText, big && s.chipTextBig, on && s.chipTextOn]}>{text}</Text>
    </Pressable>
  );
}

// Backend times are naive local ISO strings ("2026-10-28T09:30:00"): slice them, don't parse as UTC.
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymd = (iso) => iso.slice(0, 10);
const hm = (iso) => iso.slice(11, 16);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const nowIso = () => { const d = new Date(); return `${ymdOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function nextDays(n) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return ymdOf(x);
  });
}

function relative(d) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return d === ymdOf(today) ? 'Today' : d === ymdOf(tomorrow) ? 'Tomorrow' : null;
}

// "Today", "Tomorrow", "Tue, Oct 28"
const dayName = (d) => relative(d) ?? `${WEEKDAY[new Date(`${d}T00:00`).getDay()]}, ${fmtDay(d)}`;
// chips: "Today", "Tomorrow", "Tue 28"
const shortDay = (d) => relative(d) ?? `${WEEKDAY[new Date(`${d}T00:00`).getDay()]} ${Number(d.slice(8, 10))}`;

function endOf(x) {
  const [h, m] = hm(x.starts_at).split(':').map(Number);
  const t = h * 60 + m + x.minutes;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
}

// [[day, [slots…]], …] in time order (the backend already sorts by start)
function byDay(list) {
  const out = [];
  for (const x of list) {
    const d = ymd(x.starts_at);
    if (out.length && out[out.length - 1][0] === d) out[out.length - 1][1].push(x);
    else out.push([d, [x]]);
  }
  return out;
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  bodyBig: { fontSize: 19, lineHeight: 27 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 8 },
  pair: { flexDirection: 'row', gap: 10, marginTop: 14 },
  summary: { backgroundColor: colors.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.line },
  summaryTitle: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4, marginBottom: 4 },
  note: { color: colors.taken, backgroundColor: colors.takenWash, borderRadius: 10, padding: 12, fontSize: 15, marginVertical: 8 },
  dayHead: { fontSize: 15, fontWeight: '700', color: colors.muted, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderColor: colors.line },
  time: { width: 76, fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  open: { fontSize: 16, fontWeight: '600', color: colors.taken },
  small: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bg },
  smallText: { color: colors.primaryInk, fontSize: 15, fontWeight: '600' },
  visit: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  visitWhen: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: 4 },
  visitWhenBig: { fontSize: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, borderWidth: 1, borderColor: colors.line2, backgroundColor: colors.card, borderRadius: 999,
          paddingHorizontal: 16, justifyContent: 'center' },
  chipBig: { minHeight: 54, paddingHorizontal: 20 },
  chipOn: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryWash },
  chipText: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  chipTextBig: { fontSize: 19 },
  chipTextOn: { fontWeight: '700', color: colors.primaryInk },
});
