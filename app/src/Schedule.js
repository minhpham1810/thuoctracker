import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { usePoll } from './hooks';
import { ask, Button, Card, clock, colors, ErrorText, Field, Section, soft } from './ui';

const LENGTHS = [15, 30, 60]; // minutes per visit
const AHEAD_DAYS = 120; // matches the backend's MAX_AHEAD_DAYS (about 3 months)
const REPEATS = [0, 3, 7, 12]; // extra weeks: just this day, 4 weeks, 8 weeks, 13 weeks (~3 months)
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Appointments as a month calendar. Doctor: open times and who booked them. Patient and family: their visits, and
// the doctor's open days to book from.
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
  const today = todayYmd();
  const [day, setDay] = useState(addDays(today, 1)); // tomorrow: the usual case
  const [month, setMonth] = useState(day.slice(0, 7));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('12:00');
  const [minutes, setMinutes] = useState(30);
  const [repeat, setRepeat] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const counts = countByDay(slots);
  const onDay = slots.filter((x) => ymd(x.starts_at) === day);
  const weekday = WEEKDAY[dateOf(day).getDay()];

  const pick = (d) => { setDay(d); setNote(null); setError(null); };

  const open = async () => {
    setError(null);
    setNote(null);
    if (!HHMM.test(start) || !HHMM.test(end)) return setError('Times must look like 09:00 (24-hour).');
    setBusy(true);
    try {
      const r = await api.addAvailability({ day, start, end, minutes, repeat_weeks: repeat });
      const n = r.added.length;
      const days = new Set(r.added.map((x) => ymd(x.starts_at))).size;
      setNote(n
        ? `Opened ${n} ${n === 1 ? 'time' : 'times'}${days > 1 ? ` on ${days} days` : ''}.`
          + (r.skipped ? ` ${r.skipped} skipped: already in your schedule, past, or more than 3 months out.` : '')
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
        <Text style={s.muted}>Your appointments for the next 3 months</Text>
      </View>

      <Card style={{ marginTop: 16 }}>
        <MonthCalendar month={month} onMonth={setMonth} selected={day} onSelect={pick} counts={counts}
          canPick={(d) => d >= today && d <= addDays(today, AHEAD_DAYS)} min={today} max={addDays(today, AHEAD_DAYS)} />
      </Card>

      <Section title={dayName(day)}>
        {onDay.length === 0 && <Text style={s.muted}>No times on this day yet.</Text>}
        {onDay.length > 0 && (
          <Card style={{ paddingVertical: 4 }}>
            {onDay.map((x, i) => (
              <View key={x.id} style={[s.row, i > 0 && s.rule]}>
                <Text style={s.time}>{clock(hm(x.starts_at))}</Text>
                <View style={{ flex: 1 }}>
                  {x.patient_id ? <Text style={s.name}>{x.patient_name}</Text> : <Text style={s.open}>Open</Text>}
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
        )}
      </Section>

      <Section title={['Today', 'Tomorrow'].includes(dayName(day)) ? `Open times ${dayName(day).toLowerCase()}` : `Open times on ${dayName(day)}`}>
        <Card>
          <View style={s.pair}>
            <Field label="From" value={start} onChangeText={setStart} placeholder="09:00" style={{ flex: 1 }} />
            <Field label="To" value={end} onChangeText={setEnd} placeholder="12:00" style={{ flex: 1 }} />
          </View>
          <Text style={s.label}>Each visit</Text>
          <View style={s.chips}>
            {LENGTHS.map((n) => <Chip key={n} on={minutes === n} onPress={() => setMinutes(n)} text={`${n} min`} />)}
          </View>
          <Text style={[s.label, { marginTop: 14 }]}>Repeat</Text>
          <View style={s.chips}>
            {REPEATS.map((w) => (
              <Chip key={w} on={repeat === w} onPress={() => setRepeat(w)}
                    text={w === 0 ? 'Just this day' : `Every ${weekday}, ${w + 1} weeks`} />
            ))}
          </View>
          <ErrorText>{error}</ErrorText>
          {note && <Text style={s.note}>{note}</Text>}
          <Button title={busy ? 'Opening…' : 'Open these times'} onPress={open} disabled={busy || day < today}
                  style={{ marginTop: 12 }} />
        </Card>
      </Section>
    </ScrollView>
  );
}

function PatientSchedule({ user, slots, refresh }) {
  const pid = user.role === 'patient' ? user.id : user.patient_id;
  const big = user.role === 'patient'; // bigger text for the patient, like Today
  const today = todayYmd();
  const open = slots.filter((x) => !x.patient_id);
  const counts = countByDay(open);
  const firstOpen = open[0] ? ymd(open[0].starts_at) : null;
  const [day, setDay] = useState(null);
  const [month, setMonth] = useState((firstOpen ?? today).slice(0, 7));
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const mine = slots.filter((x) => x.patient_id === pid);
  const doctor = slots[0]?.doctor_name ?? 'your doctor';
  const shownDay = day && counts.has(day) ? day : firstOpen; // a day someone else just filled falls back
  const times = open.filter((x) => ymd(x.starts_at) === shownDay);
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
        <Text style={[s.muted, big && s.bodyBig, { marginBottom: 10 }]}>
          {open.length ? 'Green days have open times. Tap one, then pick a time.' : `No open times in the next 3 months. You can ask ${doctor} in the chat.`}
        </Text>
        <Card>
          <MonthCalendar month={month} onMonth={setMonth} selected={shownDay} big={big} counts={counts} hideBooked
            onSelect={(d) => { setDay(d); setPick(null); setNote(null); }} canPick={(d) => counts.has(d)}
            min={today} max={addDays(today, AHEAD_DAYS)} />
        </Card>
        {shownDay && times.length > 0 && (
          <>
            <Text style={[s.label, big && s.labelBig, { marginTop: 16 }]}>{dayName(shownDay)}</Text>
            <View style={s.chips}>
              {times.map((x) => (
                <Chip key={x.id} big={big} on={chosen?.id === x.id} onPress={() => setPick(x)} text={clock(hm(x.starts_at))} />
              ))}
            </View>
          </>
        )}
        {chosen && (
          <Card style={{ marginTop: 14 }}>
            <Field label="Reason for the visit" hint="optional" value={reason} onChangeText={setReason}
                   placeholder="e.g. Blood pressure check" maxLength={300} />
            <Button title={busy ? 'Booking…' : `Book ${label(chosen)}`} big={big} onPress={book} disabled={busy} />
          </Card>
        )}
        <ErrorText>{error}</ErrorText>
        {note && <Text style={[s.note, big && s.bodyBig]}>{note}</Text>}
      </Section>
    </ScrollView>
  );
}

// Month grid with ‹ › between min and max. Green day = open times; a teal dot = booked visits (doctor view).
// canPick(day) decides which days can be tapped.
function MonthCalendar({ month, onMonth, selected, onSelect, counts, canPick, min, max, big, hideBooked }) {
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    onMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };
  const prevOk = month > min.slice(0, 7);
  const nextOk = month < max.slice(0, 7);
  return (
    <View>
      <View style={s.calHead}>
        <Pressable onPress={prevOk ? () => shift(-1) : undefined} disabled={!prevOk} hitSlop={8} accessibilityRole="button"
          accessibilityLabel="Previous month" style={[s.calNav, !prevOk && { opacity: 0.3 }]}>
          <Text style={s.calNavText}>‹</Text>
        </Pressable>
        <Text style={[s.calTitle, big && { fontSize: 21 }]} accessibilityRole="header">{MONTH[m - 1]} {y}</Text>
        <Pressable onPress={nextOk ? () => shift(1) : undefined} disabled={!nextOk} hitSlop={8} accessibilityRole="button"
          accessibilityLabel="Next month" style={[s.calNav, !nextOk && { opacity: 0.3 }]}>
          <Text style={s.calNavText}>›</Text>
        </Pressable>
      </View>
      <View style={s.calRow}>
        {WEEKDAY.map((w) => <Text key={w} style={[s.calWd, big && { fontSize: 14 }]}>{w.slice(0, 1)}</Text>)}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={s.calRow}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (!d) return <View key={`b${i}`} style={s.calCell} />;
            const c = counts.get(d);
            const ok = canPick(d);
            const on = d === selected;
            return (
              <Pressable key={d} onPress={ok ? () => onSelect(d) : undefined} disabled={!ok}
                accessibilityRole="button" accessibilityState={{ selected: on, disabled: !ok }}
                accessibilityLabel={`${dayName(d)}: ${c?.open ? `${c.open} open` : 'no open times'}${!hideBooked && c?.booked ? `, ${c.booked} booked` : ''}`}
                style={s.calCell}>
                <View style={[s.calDay, big && s.calDayBig, c?.open && s.calOpen, d === min && s.calToday, on && s.calOn]}>
                  <Text style={[s.calNum, big && { fontSize: 18 }, !ok && s.calOff, on && { color: '#fff' }]}>{Number(d.slice(8))}</Text>
                  {!hideBooked && c?.booked ? <View style={[s.dot, on && { backgroundColor: '#fff' }]} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
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
const dateOf = (d) => new Date(`${d}T00:00`);
const todayYmd = () => ymdOf(new Date());
const nowIso = () => { const d = new Date(); return `${ymdOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function addDays(d, n) {
  const x = dateOf(d);
  x.setDate(x.getDate() + n);
  return ymdOf(x);
}

// "Today", "Tomorrow", "Tue, Oct 28"
function dayName(d) {
  const today = todayYmd();
  if (d === today) return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  const x = dateOf(d);
  return `${WEEKDAY[x.getDay()]}, ${MONTH[x.getMonth()].slice(0, 3)} ${x.getDate()}`;
}

function endOf(x) {
  const [h, m] = hm(x.starts_at).split(':').map(Number);
  const t = h * 60 + m + x.minutes;
  return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
}

// day -> {open, booked}
function countByDay(list) {
  const out = new Map();
  for (const x of list) {
    const c = out.get(ymd(x.starts_at)) ?? { open: 0, booked: 0 };
    if (x.patient_id) c.booked++;
    else c.open++;
    out.set(ymd(x.starts_at), c);
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
  labelBig: { fontSize: 19 },
  pair: { flexDirection: 'row', gap: 10 },
  summary: { backgroundColor: colors.card, borderRadius: 26, padding: 20, ...soft.raised },
  summaryTitle: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4, marginBottom: 4 },
  note: { color: colors.taken, backgroundColor: colors.takenWash, borderRadius: 14, padding: 12, fontSize: 15, marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderColor: colors.line },
  time: { width: 76, fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  open: { fontSize: 16, fontWeight: '600', color: colors.taken },
  small: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.card, ...soft.raisedSm },
  smallText: { color: colors.primaryInk, fontSize: 15, fontWeight: '600' },
  visit: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  visitWhen: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: 4 },
  visitWhenBig: { fontSize: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, borderWidth: 1, borderColor: 'transparent', backgroundColor: colors.card, borderRadius: 999, ...soft.raisedSm,
          paddingHorizontal: 16, justifyContent: 'center' },
  chipBig: { minHeight: 54, paddingHorizontal: 20 },
  chipOn: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryWash, ...soft.pressed },
  chipText: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  chipTextBig: { fontSize: 19 },
  chipTextOn: { fontWeight: '700', color: colors.primaryInk },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNav: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, ...soft.raisedSm },
  calNavText: { fontSize: 28, lineHeight: 30, color: colors.primaryInk, marginTop: -3 },
  calTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  calRow: { flexDirection: 'row' },
  calWd: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.muted, paddingVertical: 4 },
  calCell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  calDay: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  calDayBig: { width: 46, height: 46, borderRadius: 23 },
  calOpen: { backgroundColor: colors.takenWash },
  calToday: { borderColor: colors.primary },
  calOn: { backgroundColor: colors.primary, borderColor: colors.primary, ...soft.raisedSm },
  calNum: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  calOff: { color: colors.line2, fontWeight: '400' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary, marginTop: 1 },
});
