import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { ask, Button, Capsule, colors, ErrorText, Field, Section, soft } from './ui';

// The Android build made before expo-image-picker was added has no camera module: say so instead of crashing.
const ImagePicker = Platform.OS === 'web' || requireOptionalNativeModule('ExponentImagePicker')
  ? require('expo-image-picker')
  : null;

const SLOTS = [1, 2, 3, 4, 5, 6, 7]; // boxes 1-3 top row, 4-6 middle row, 7 the long bottom box
const COLORS = ['white', 'blue', 'red', 'yellow', 'green', 'orange', 'pink', 'purple'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Scan a bottle label with the phone; Gemini fills in the form; a person checks every field and saves.
export default function AddMedicine({ patientId, meds, autoScan, onDone }) {
  const free = SLOTS.filter((n) => !meds.some((m) => m.slot === n));
  const [photo, setPhoto] = useState(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [f, setF] = useState({
    // empty, not example values: anything filled in must come from the label or the person
    name: '', dose: '', times: '', expiration: '', pills_left: '', slot: free[0] ?? null, color: 'white',
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (autoScan) scan(true); }, []); // "Scan a label": straight to the camera

  const scan = async (camera) => {
    setError(null);
    if (!ImagePicker) return setError('This version of the app has no camera support. Install the latest build.');
    if (camera && Platform.OS !== 'web' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      return setError('Allow camera access to scan a label.');
    }
    // base64: the phone sends the photo as JSON text. SDK 58's fetch rejects multipart file parts on phones
    // ("Unsupported FormDataPart implementation"), and base64 needs no File/Blob support at all.
    const opts = { mediaTypes: ['images'], quality: 0.6, base64: Platform.OS !== 'web' }; // smaller upload, still readable
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return;
    const asset = res.assets[0];
    setPhoto(asset.uri);
    setReading(true);
    try {
      let d; // nulls for anything the AI couldn't read
      if (Platform.OS === 'web') {
        const form = new FormData(); // browsers upload files fine
        form.append('photo', await (await fetch(asset.uri)).blob(), 'label.jpg');
        d = await api.readLabel(form);
      } else if (asset.base64) {
        d = await api.readLabelBase64(asset.base64);
      } else {
        throw new Error('the camera gave no photo data');
      }
      setF((x) => ({
        ...x,
        name: d.name ?? x.name,
        dose: d.dose ?? x.dose,
        times: d.times?.length ? d.times.join(', ') : x.times,
        expiration: d.expiration ?? x.expiration,
        pills_left: d.quantity != null ? String(d.quantity) : x.pills_left,
      }));
    } catch (e) {
      setError(`Couldn't read the label (${e.message}). Fill it in by hand.`);
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    setError(null);
    const times = f.times.split(/[,\s]+/).filter(Boolean);
    const pills = parseInt(f.pills_left, 10);
    if (!f.name.trim()) return setError('Enter the medicine name.');
    if (!times.length || !times.every((t) => HHMM.test(t))) return setError('Times must look like 08:00, 20:00.');
    if (!YMD.test(f.expiration)) return setError('Expiration must look like 2027-01-31.');
    if (!(pills >= 0)) return setError('Enter how many pills are in the bottle.');
    if (!f.slot) return setError('All 7 boxes are full. Remove a medicine first.');
    const m = {
      patient_id: patientId, name: f.name.trim(), dose: f.dose.trim() || '1 pill', times,
      expiration: f.expiration, pills_left: pills, slot: f.slot, color: f.color,
    };
    setSaving(true);
    try {
      // fresh list: someone else may have added it a moment ago
      const current = await api.medicines(patientId);
      const dup = current.find((x) => x.name.trim().toLowerCase() === m.name.toLowerCase());
      if (dup && !(await ask('Already added', `${dup.name} was already added (box ${dup.slot}). Are you sure you want to add it again?`, 'Add again'))) {
        setSaving(false);
        return;
      }
      await api.addMedicine(m);
      onDone(true);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.h1} accessibilityRole="header">Add a medicine</Text>
        <Pressable onPress={() => onDone(false)} hitSlop={12} accessibilityRole="button" style={s.cancel}>
          <Text style={s.link}>Cancel</Text>
        </Pressable>
      </View>

      <View style={s.scan}>
        <Text style={s.scanTitle}>{reading ? 'Reading the label…' : 'Scan the bottle label'}</Text>
        <Text style={s.muted}>The name, dose, times, expiration and pill count are filled in for you. Check every field before saving.</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Button title="Take a photo" onPress={() => !reading && scan(true)} disabled={reading} style={{ flex: 1 }} />
          <Button title="Choose photo" kind="secondary" onPress={() => !reading && scan(false)} disabled={reading} style={{ flex: 1 }} />
        </View>
        {photo && <Image source={{ uri: photo }} style={s.photo} resizeMode="contain" accessibilityLabel="Label photo" />}
      </View>

      <Section title="Prescription">
        <Field label="Name" value={f.name} onChangeText={set('name')} placeholder="e.g. Aspirin" />
        <Field label="Dose" value={f.dose} onChangeText={set('dose')} placeholder="e.g. 1 pill" />
        <Field label="Times" hint="24-hour, separated by commas" value={f.times} onChangeText={set('times')} placeholder="e.g. 08:00, 20:00" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="Pills in the bottle" value={f.pills_left} onChangeText={set('pills_left')} keyboardType="number-pad"
                 placeholder="e.g. 30" style={{ flex: 1 }} />
          <Field label="Expiration" value={f.expiration} onChangeText={set('expiration')} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
        </View>
      </Section>

      <Section title="Cabinet box">
        {free.length === 0 && <ErrorText>All 7 boxes are full. Remove a medicine first.</ErrorText>}
        {/* laid out like the cabinet: boxes 1-3, 4-6, then the long box 7 */}
        <View style={s.cabinet}>
          {[[1, 2, 3], [4, 5, 6], [7]].map((row) => (
            <View key={row[0]} style={{ flexDirection: 'row', gap: 6 }}>
              {row.map((n) => {
                const used = meds.find((m) => m.slot === n);
                const on = f.slot === n;
                return (
                  <Pressable key={n} onPress={used ? undefined : () => set('slot')(n)} disabled={!!used}
                    accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !!used }}
                    accessibilityLabel={`Box ${n}, ${used ? `has ${used.name}` : 'free'}`}
                    style={[s.boxOpt, used ? s.boxUsed : on ? s.boxOn : s.boxFree]}>
                    <Text style={[s.boxNum, (used || on) && { color: colors.text }]}>{n}</Text>
                    <Text style={[s.boxSub, (used || on) && { color: colors.muted }]} numberOfLines={1}>
                      {used ? used.name : on ? 'Chosen' : 'Free'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </Section>

      <Section title="Pill color">
        <Text style={[s.muted, { marginTop: -4, marginBottom: 10 }]}>Shown on the cabinet screen so the pill is easy to match.</Text>
        <View style={s.chips}>
          {COLORS.map((c) => (
            <Pressable key={c} onPress={() => set('color')(c)} accessibilityRole="radio" accessibilityState={{ checked: f.color === c }}
              style={[s.chip, f.color === c && s.chipOn]}>
              <Capsule color={c} />
              <Text style={[s.chipText, f.color === c && { fontWeight: '700' }]}>{c[0].toUpperCase() + c.slice(1)}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <ErrorText>{error}</ErrorText>
      <Button title={saving ? 'Saving…' : 'Save to cabinet'} big onPress={() => !saving && !reading && save()}
              disabled={saving || reading} style={{ marginTop: 20 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  h1: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  cancel: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.card, ...soft.raisedSm },
  link: { color: colors.primaryInk, fontSize: 16, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  scan: { backgroundColor: colors.primaryWash, borderRadius: 22, padding: 16, borderWidth: 1.5, borderStyle: 'dashed',
          borderColor: 'rgba(42,111,107,0.45)' },
  scanTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  photo: { width: '100%', height: 180, marginTop: 12, borderRadius: 12, backgroundColor: colors.card },
  cabinet: { backgroundColor: colors.cab, borderRadius: 18, padding: 8, gap: 6, ...soft.raised },
  boxOpt: { flex: 1, minHeight: 54, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center' },
  boxFree: { backgroundColor: colors.well, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.25)' },
  boxOn: { backgroundColor: colors.card, borderWidth: 3, borderColor: '#8FD3C8' },
  boxUsed: { backgroundColor: colors.line },
  boxNum: { fontSize: 17, fontWeight: '800', color: '#fff' },
  boxSub: { fontSize: 13, color: '#C4DBD6' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderWidth: 1, borderColor: 'transparent',
          backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 14, ...soft.raisedSm },
  chipOn: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primaryWash, ...soft.pressed },
  chipText: { fontSize: 15, color: colors.text },
});
