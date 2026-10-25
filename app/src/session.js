// Small JSON values kept across launches: the login ({token, user, url}) and Settings prefs.
// Phones: files in the app's documents folder. expo-file-system ships inside `expo`, so the
// Android dev build already has it (no rebuild). Browser: localStorage.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

const FS = Platform.OS !== 'web' && requireOptionalNativeModule('FileSystem') ? require('expo-file-system') : null;

function store(name) {
  const key = `thuoc-${name}`;
  const file = FS ? new FS.File(FS.Paths.document, `${name}.json`) : null; // no native module: nothing is kept
  return {
    load() {
      try {
        if (Platform.OS === 'web') return JSON.parse(localStorage.getItem(key) ?? 'null');
        return file?.exists ? JSON.parse(file.textSync()) : null;
      } catch {
        return null;
      }
    },
    save(value) {
      try {
        if (Platform.OS === 'web') localStorage.setItem(key, JSON.stringify(value));
        else file?.write(JSON.stringify(value))?.catch?.(() => {});
      } catch {}
    },
    clear() {
      try {
        if (Platform.OS === 'web') localStorage.removeItem(key);
        else if (file?.exists) file.delete();
      } catch {}
    },
  };
}

const session = store('session');
export const loadSession = session.load;
export const saveSession = session.save;
export const clearSession = session.clear;
export const prefs = store('prefs'); // Settings: {clock24}
