// Remembers the login ({token, user, url}) so the app opens logged in.
// Phones: a file in the app's documents folder. expo-file-system ships inside `expo`, so the
// Android dev build already has it (no rebuild). Browser: localStorage.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

const KEY = 'thuoc-session';
const file = Platform.OS !== 'web' && requireOptionalNativeModule('FileSystem')
  ? (() => { const { File, Paths } = require('expo-file-system'); return new File(Paths.document, 'session.json'); })()
  : null; // no native module: log in each time

export function loadSession() {
  try {
    if (Platform.OS === 'web') return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return file?.exists ? JSON.parse(file.textSync()) : null;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  try {
    if (Platform.OS === 'web') localStorage.setItem(KEY, JSON.stringify(s));
    else file?.write(JSON.stringify(s))?.catch?.(() => {});
  } catch {}
}

export function clearSession() {
  try {
    if (Platform.OS === 'web') localStorage.removeItem(KEY);
    else if (file?.exists) file.delete();
  } catch {}
}
