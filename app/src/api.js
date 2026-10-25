// Talks to the backend (see TEAM.md for routes). The URL is set on the login screen
// because the laptop's hotspot IP changes.
import Constants from 'expo-constants';

// In development the app is served by Expo on the backend laptop, so its host is the laptop's IP
// (in a browser: the page's own host).
const devHost = Constants.expoConfig?.hostUri?.split(':')[0] ?? globalThis.location?.hostname;
let base = process.env.EXPO_PUBLIC_BACKEND_URL || (devHost ? `http://${devHost}:8000` : 'http://192.168.137.1:8000');
let token = null; // session token from /login or /signup
let unauthorized = null;

export const setBaseUrl = (url) => { base = url.trim().replace(/\/+$/, ''); };
export const getBaseUrl = () => base;
export const setToken = (t) => { token = t; };
export const onUnauthorized = (fn) => { unauthorized = fn; }; // session gone: back to login

async function call(method, path, body, { timeout = 6000, form } = {}) {
  // fetch has no timeout of its own; a wrong IP would hang for a minute with no feedback
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, {
      method, signal: ctrl.signal, headers, body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    if (res.status === 401 && token) unauthorized?.();
    if (!res.ok) {
      const detail = (await res.json().catch(() => null))?.detail;
      // FastAPI sends a string for HTTPException and a list for validation errors
      throw new Error((Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : detail) || `${method} ${path}: ${res.status}`);
    }
    return res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  signup: (form) => call('POST', '/signup', form),
  login: (email, password) => call('POST', '/login', { email, password }),
  logout: () => call('POST', '/logout'),
  me: () => call('GET', '/me'),
  health: () => call('GET', '/health'),
  contacts: () => call('GET', '/contacts'), // [{user, unread, last}]
  // all of my messages, or only the ones with withId (which marks theirs read)
  messages: (withId) => call('GET', `/messages${withId ? `?with_id=${withId}` : ''}`),
  sendMessage: (toId, text) => call('POST', '/messages', { to_id: toId, text }),
  alerts: () => call('GET', '/alerts'),
  medicines: (pid) => call('GET', `/patients/${pid}/medicines`),
  addMedicine: (m) => call('POST', '/medicines', m), // doctor or family
  // label photo (FormData field "photo") -> {name, dose, times, expiration, quantity}; Gemini can take a while
  readLabel: (form) => call('POST', '/ai/label', null, { form, timeout: 150000 }), // local Ollama on a CPU laptop is slow
  // phones: the same, with the photo as base64 JSON (SDK 58's fetch can't send multipart files from a phone)
  readLabelBase64: (image) => call('POST', '/ai/label64', { image }, { timeout: 150000 }),
  doses: (pid) => call('GET', `/patients/${pid}/doses`),
  took: (doseId) => call('POST', `/doses/${doseId}/taken`),
  cabinetState: (pid) => call('GET', `/cabinet/${pid}/state`),
  registerPush: (pushToken) => call('POST', '/push/register', { token: pushToken }),
  // appointments
  schedule: () => call('GET', '/schedule'), // doctor: all their times; patient/family: open times + their visits
  addAvailability: (a) => call('POST', '/availability', a), // {day, start, end, minutes} -> {added, skipped}
  book: (slotId, body) => call('POST', `/slots/${slotId}/book`, body), // {patient_id?, reason?}
  cancelBooking: (slotId) => call('POST', `/slots/${slotId}/cancel`),
  removeSlot: (slotId) => call('DELETE', `/slots/${slotId}`),
};

// Backend times are local and naive ("2026-10-24T15:01:50.9"), so slice instead of new Date().
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');
