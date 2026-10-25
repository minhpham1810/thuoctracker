import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AddMedicine from './AddMedicine';
import { api, hhmm } from './api';
import { usePoll } from './hooks';
import { Button, Capsule, Card, clock, colors, fmtDay, pillColor, Section, Status } from './ui';

const LOW = 5; // backend's low-pill rule; display only
const EXPIRING_DAYS = 7;

// "Today" for one patient: what's happening now, today's pills, medicines, alerts (family/doctor), earlier doses.
export default function PatientView({ user, patientId }) {
  const [tick, setTick] = useState(0); // bump to refetch right after "I took it"
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(null); // null, 'scan' (camera opens right away) or 'manual'
  const [data, error] = usePoll(async () => {
    const [meds, doses, alerts, cabinet] = await Promise.all([
      api.medicines(patientId), api.doses(patientId), api.alerts(), api.cabinetState(patientId)]);
    return { meds, doses, cabinet, alerts: alerts.filter((a) => a.patient_id === patientId).reverse() };
  }, [patientId, tick]);

  if (!data) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>{error ? `Can't reach the server (${error}). Retrying…` : 'Loading…'}</Text>
      </View>
    );
  }
  if (adding) {
    return <AddMedicine patientId={patientId} meds={data.meds} autoScan={adding === 'scan'}
                        onDone={(saved) => { setAdding(null); if (saved) setTick((x) => x + 1); }} />;
  }
  const big = user.role === 'patient';
  const now = new Date();
  const today = todayItems(data.meds, data.doses, now);
  const myAlerts = data.alerts.filter((a) => user.role === 'doctor' ? a.to === 'doctor' : a.to === 'family');
  const earlier = data.doses.filter((d) => !d.due_at.startsWith(ymdOf(now)))
    .sort((a, b) => b.due_at.localeCompare(a.due_at)).slice(0, 12);
  const medById = Object.fromEntries(data.meds.map((m) => [m.id, m]));

  const tookIt = async () => {
    setSaving(true);
    await api.took(data.cabinet.dose_id).catch(() => {});
    setSaving(false);
    setTick((x) => x + 1);
  };

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Now cabinet={data.cabinet} today={today} meds={data.meds} big={big} saving={saving} onTook={tookIt} role={user.role} />

      <Section title="Today">
        {today.length === 0 && <Text style={s.muted}>No pills scheduled today.</Text>}
        {today.length > 0 && (
          <Card style={{ paddingVertical: 4 }}>
            {today.map((x, i) => (
              <View key={x.key} style={[s.row, i > 0 && s.rule]}>
                <Text style={[s.time, big && s.timeBig, x.status === 'later' && s.dim]}>{clock(x.at)}</Text>
                <Capsule color={x.color} size={big ? 1.2 : 1} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, big && s.nameBig, x.status === 'later' && s.dim]}>{x.name}</Text>
                  <Text style={s.muted}>
                    {[x.slot && `Box ${x.slot}`, x.log?.taken_at && `taken ${clock(hhmm(x.log.taken_at))}`].filter(Boolean).join(', ')}
                  </Text>
                  {/* bigger text for the patient: the chip goes under the name so names don't break */}
                  {big && <View style={{ marginTop: 6 }}><Status status={x.status} text={statusText(x)} /></View>}
                </View>
                {!big && <Status status={x.status} text={statusText(x)} />}
              </View>
            ))}
          </Card>
        )}
      </Section>

      <Section title="Medicines">
        {(user.role === 'doctor' || user.role === 'family') && (
          <View style={s.addRow}>
            <Button title="Scan a label" onPress={() => setAdding('scan')} style={{ flex: 1 }} />
            <Button title="Type it in" kind="secondary" onPress={() => setAdding('manual')} style={{ flex: 1 }} />
          </View>
        )}
        {data.meds.length === 0 && <Text style={s.muted}>No medicines in the cabinet yet.</Text>}
        {data.meds.map((m) => {
          const low = m.pills_left < LOW;
          const daysLeft = Math.floor(m.pills_left / Math.max(1, m.times.length));
          const exp = daysUntil(m.expiration, now);
          return (
            <Card key={m.id}>
              <View style={s.medTop}>
                <Capsule color={m.color} size={1.3} />
                <Text style={[s.name, big && s.nameBig, { flex: 1 }]}>{m.name}</Text>
                <View style={s.box}><Text style={s.boxText}>Box {m.slot}</Text></View>
              </View>
              <Text style={[s.body, big && s.bodyBig]}>{m.dose}, {m.times.map(clock).join(' and ')}</Text>
              <View style={s.meter}>
                <View style={[s.meterFill, { width: `${Math.min(100, (100 * m.pills_left) / 30)}%`, backgroundColor: low ? colors.missed : colors.taken }]} />
              </View>
              <View style={s.medFoot}>
                <Text style={[s.body, low && { color: colors.missed, fontWeight: '700' }]}>
                  {m.pills_left} left{low ? ', refill soon' : `, about ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}
                </Text>
                <Text style={[s.muted, exp <= EXPIRING_DAYS && { color: colors.pending, fontWeight: '700' }]}>
                  {exp < 0 ? 'Expired' : exp <= EXPIRING_DAYS ? (exp === 0 ? 'Expires today' : `Expires in ${exp} ${exp === 1 ? 'day' : 'days'}`) : `Expires ${fmtDay(m.expiration, true)}`}
                </Text>
              </View>
            </Card>
          );
        })}
      </Section>

      {!big && (
        <Section title="Alerts">
          {myAlerts.length === 0 && <Text style={s.muted}>No alerts. Everything is on track.</Text>}
          {myAlerts.slice(0, 10).map((a) => {
            const tone = a.type === 'missed' ? [colors.missedWash, colors.missed] : [colors.pendingWash, colors.pending];
            return (
              <Card key={a.id} style={s.alert}>
                <View style={[s.alertMark, { backgroundColor: tone[0] }]}>
                  <Text style={{ color: tone[1], fontWeight: '800' }}>{a.type === 'missed' ? '✕' : '!'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.alertTitle}>{ALERT_LABEL[a.type]}</Text>
                  <Text style={s.body}>{a.message}</Text>
                  <Text style={s.muted}>{dayLabel(a.at, now)} at {clock(hhmm(a.at))}</Text>
                </View>
              </Card>
            );
          })}
        </Section>
      )}

      {earlier.length > 0 && (
        <Section title="Earlier">
          <Card style={{ paddingVertical: 4 }}>
            {earlier.map((d, i) => {
              const status = d.status === 'pending' ? 'due' : d.status;
              const newDay = i === 0 || earlier[i - 1].due_at.slice(0, 10) !== d.due_at.slice(0, 10);
              return (
                <View key={d.id}>
                  {newDay && <Text style={[s.dayLabel, i > 0 && s.rule]}>{dayLabel(d.due_at, now)}</Text>}
                  <View style={s.row}>
                    <Text style={s.time}>{clock(hhmm(d.due_at))}</Text>
                    <Capsule color={medById[d.medicine_id]?.color} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{medById[d.medicine_id]?.name ?? 'Medicine'}</Text>
                      {d.taken_at ? (
                        <Text style={s.muted}>Taken {clock(hhmm(d.taken_at))}, {d.method === 'camera' ? 'seen by camera' : 'tapped on screen'}</Text>
                      ) : null}
                    </View>
                    <Status status={status} text={status === 'taken' ? 'Taken' : status === 'missed' ? 'Missed' : 'Waiting'} />
                  </View>
                </View>
              );
            })}
          </Card>
        </Section>
      )}
    </ScrollView>
  );
}

// The card at the top: pill time, a missed pill, or how today is going.
function Now({ cabinet, today, meds, big, saving, onTook, role }) {
  if (cabinet.mode === 'take') {
    const m = meds.find((x) => x.slot === cabinet.slot);
    return (
      <View style={[s.now, { borderColor: pillColor(cabinet.color), borderWidth: 3 }]} accessibilityRole="alert">
        <View style={s.nowTop}>
          <Capsule color={cabinet.color} size={1.6} />
          <Text style={s.nowKicker}>Pill time</Text>
        </View>
        <Text style={[s.nowTitle, big && s.nowTitleBig]}>{cabinet.message}</Text>
        <Text style={[s.body, big && s.bodyBig]}>
          Open box {cabinet.slot} on the cabinet{m ? ` and take ${m.dose}` : ''}.
        </Text>
        {role === 'patient'
          ? <Button title={saving ? 'Saving…' : 'I took it'} kind="done" big onPress={onTook} disabled={saving} style={{ marginTop: 14 }} />
          : <Text style={[s.muted, { marginTop: 8 }]}>The cabinet is reminding them now. You'll be told if it's missed.</Text>}
      </View>
    );
  }
  if (cabinet.mode === 'missed') {
    return (
      <View style={[s.now, { backgroundColor: colors.missedWash, borderColor: colors.missedWash }]} accessibilityRole="alert">
        <Text style={[s.nowKicker, { color: colors.missed }]}>Missed pill</Text>
        <Text style={[s.nowTitle, big && s.nowTitleBig]}>{cabinet.medicine} was not taken</Text>
        <Text style={s.body}>{role === 'patient' ? 'Your family and doctor have been told.' : 'The family and doctor have been told.'}</Text>
      </View>
    );
  }
  const taken = today.filter((x) => x.status === 'taken').length;
  const next = today.find((x) => x.status === 'later');
  return (
    <View style={s.now}>
      <Text style={[s.nowTitle, big && s.nowTitleBig]}>
        {today.length === 0 ? 'No pills today' : `${taken} of ${today.length} ${today.length === 1 ? 'pill' : 'pills'} taken today`}
      </Text>
      {today.length > 0 && (
        <View style={s.progress} accessibilityLabel={`${taken} of ${today.length} taken`}>
          {today.map((x) => (
            <View key={x.key} style={[s.progressSeg, { backgroundColor:
              x.status === 'taken' ? colors.taken : x.status === 'missed' ? colors.missed : x.status === 'due' ? colors.primary : colors.line }]} />
          ))}
        </View>
      )}
      <Text style={[s.body, big && s.bodyBig]}>
        {next ? `Next: ${next.name} at ${clock(next.at)}, box ${next.slot}` : today.length ? 'All done for today.' : 'Nothing to take.'}
      </Text>
    </View>
  );
}

const ALERT_LABEL = { missed: 'Missed dose', low_pills: 'Refill needed', expiring_soon: 'Expiring soon' };

function statusText(x) {
  if (x.status === 'taken') return 'Taken';
  return x.status === 'missed' ? 'Missed' : x.status === 'due' ? 'Now' : 'Later';
}

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysUntil = (ymd, now) => Math.round((new Date(`${ymd}T00:00`) - new Date(ymdOf(now) + 'T00:00')) / 86400000);

function dayLabel(iso, now) {
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const d = iso.slice(0, 10);
  return d === ymdOf(now) ? 'Today' : d === ymdOf(y) ? 'Yesterday' : fmtDay(iso);
}

// Same as the web's todayItems: logged doses (taken / missed / due) plus times still to come. Display only.
function todayItems(meds, doses, now) {
  const ymd = ymdOf(now);
  const nowHm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const med = (id) => meds.find((m) => m.id === id);
  const logged = doses.filter((d) => d.due_at.startsWith(ymd)).map((d) => ({
    key: `d${d.id}`, at: d.due_at.slice(11, 16), name: med(d.medicine_id)?.name ?? 'Medicine', log: d,
    color: med(d.medicine_id)?.color, slot: med(d.medicine_id)?.slot, status: d.status === 'pending' ? 'due' : d.status,
  }));
  const later = meds.flatMap((m) => m.times
    .filter((t) => t > nowHm && !doses.some((d) => d.medicine_id === m.id && d.due_at.startsWith(`${ymd}T${t}`)))
    .map((t) => ({ key: `m${m.id}-${t}`, at: t, name: m.name, color: m.color, slot: m.slot, status: 'later' })));
  return [...logged, ...later].sort((a, b) => a.at.localeCompare(b.at));
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  dim: { color: colors.muted, fontWeight: '500' },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  bodyBig: { fontSize: 19, lineHeight: 27 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: 1, borderColor: colors.line },
  time: { width: 72, fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  timeBig: { width: 86, fontSize: 18 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  nameBig: { fontSize: 21 },
  addRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  medTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  box: { backgroundColor: colors.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  boxText: { fontSize: 13, fontWeight: '700', color: colors.text },
  meter: { height: 6, borderRadius: 3, backgroundColor: colors.bg, overflow: 'hidden', marginTop: 12, marginBottom: 8 },
  meterFill: { height: '100%', borderRadius: 3 },
  medFoot: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  alert: { flexDirection: 'row', gap: 12 },
  alertMark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  dayLabel: { fontSize: 13, fontWeight: '700', color: colors.muted, paddingTop: 12 },
  now: { backgroundColor: colors.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.line },
  nowTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  nowKicker: { fontSize: 15, fontWeight: '700', color: colors.primaryInk },
  nowTitle: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4, marginBottom: 6 },
  nowTitleBig: { fontSize: 30 },
  progress: { flexDirection: 'row', gap: 4, marginVertical: 10 },
  progressSeg: { flex: 1, height: 10, borderRadius: 5 },
});
