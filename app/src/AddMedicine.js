import { requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from './api';
import { Button, Card, colors, Dot, Title } from './ui';

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
      if (dup && !(await confirm(`${dup.name} was already added (box ${dup.slot}). Are you sure you want to add it again?`))) {
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
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={s.head}>
        <Text style={s.h1}>Add a medicine</Text>
        <Pressable onPress={() => onDone(false)} hitSlop={12}><Text style={s.link}>Cancel</Text></Pressable>
      </View>

      <Card>
        <Text style={s.muted}>Scan the bottle label to fill in the form, or type it in below. Check every field before saving.</Text>
        <Button title={reading ? 'Reading the label…' : '📷  Scan label with camera'} big onPress={() => !reading && scan(true)} />
        <Button title="Choose a photo" kind="ghost" onPress={() => !reading && scan(false)} />
        {photo && <Image source={{ uri: photo }} style={s.photo} resizeMode="contain" />}
      </Card>

      <Title>Medicine</Title>
      <Field label="Name" value={f.name} onChangeText={set('name')} placeholder="e.g. Aspirin" />
      <Field label="Dose" value={f.dose} onChangeText={set('dose')} placeholder="e.g. 1 pill" />
      <Field label="Times (24h, comma separated)" value={f.times} onChangeText={set('times')} placeholder="e.g. 08:00, 20:00" />
      <Field label="Expiration (YYYY-MM-DD)" value={f.expiration} onChangeText={set('expiration')} placeholder="e.g. 2027-01-31" />
      <Field label="Pills in the bottle" value={f.pills_left} onChangeText={set('pills_left')} keyboardType="number-pad" placeholder="e.g. 30" />

      <Title>Box in the cabinet</Title>
      {free.length === 0 && <Text style={s.error}>All 7 boxes are full.</Text>}
      <View style={s.chips}>
        {free.map((n) => (
          <Pressable key={n} onPress={() => set('slot')(n)} style={[s.chip, f.slot === n && s.chipOn]}>
            <Text style={[s.chipText, f.slot === n && { color: '#fff' }]}>Box {n}</Text>
          </Pressable>
        ))}
      </View>

      <Title>Pill color (shown on the cabinet screen)</Title>
      <View style={s.chips}>
        {COLORS.map((c) => (
          <Pressable key={c} onPress={() => set('color')(c)} style={[s.chip, s.colorChip, f.color === c && s.chipOn]}>
            <Dot color={c} />
            <Text style={[s.chipText, f.color === c && { color: '#fff' }]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={s.error}>{error}</Text>}
      <View style={{ height: 8 }} />
      <Button title={saving ? 'Saving…' : 'Save medicine'} big onPress={() => !saving && !reading && save()} />
    </ScrollView>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} autoCorrect={false} {...props} />
    </View>
  );
}

// Alert.alert buttons don't work in a browser
function confirm(message) {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => Alert.alert('Already added', message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Add again', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  link: { color: colors.primary, fontSize: 16 },
  muted: { color: colors.muted, marginBottom: 8 },
  photo: { width: '100%', height: 180, marginTop: 8, borderRadius: 10, backgroundColor: colors.bg },
  label: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, borderRadius: 999,
          paddingHorizontal: 14, paddingVertical: 8 },
  colorChip: { flexDirection: 'row', alignItems: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, color: colors.text },
  error: { color: colors.missed, marginTop: 10, fontSize: 15 },
});
