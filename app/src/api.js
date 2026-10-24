// Talks to the backend (see TEAM.md for routes). The URL is set on the login screen
// because the laptop's hotspot IP changes.
import Constants from 'expo-constants';

// In development the app is served by Expo on the backend laptop, so its host is the laptop's IP
// (in a browser: the page's own host).
const devHost = Constants.expoConfig?.hostUri?.split(':')[0] ?? globalThis.location?.hostname;
let base = process.env.EXPO_PUBLIC_BACKEND_URL || (devHost ? `http://${devHost}:8000` : 'http://192.168.137.1:8000');

export const setBaseUrl = (url) => { base = url.trim().replace(/\/+$/, ''); };
export const getBaseUrl = () => base;

async function call(method, path, body) {
  // fetch has no timeout of its own; a wrong IP would hang for a minute with no feedback
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(base + path, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `${method} ${path}: ${res.status}`);
    return res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  login: (email) => call('POST', '/login', { email }),
  contacts: (userId) => call('GET', `/users/${userId}/contacts`),
  medicines: (pid) => call('GET', `/patients/${pid}/medicines`),
  doses: (pid) => call('GET', `/patients/${pid}/doses`),
  alerts: () => call('GET', '/alerts'),
  cabinetState: (pid) => call('GET', `/cabinet/${pid}/state`),
  // all of my messages, or only the ones with withId
  messages: (userId, withId) => call('GET', `/users/${userId}/messages${withId ? `?with_id=${withId}` : ''}`),
  sendMessage: (userId, toId, text) => call('POST', `/users/${userId}/messages`, { to_id: toId, text }),
  registerPush: (userId, token) => call('POST', '/push/register', { user_id: userId, token }),
};

// Backend times are local and naive ("2026-10-24T15:01:50.9"), so slice instead of new Date().
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');
export const day = (iso) => (iso ? iso.slice(5, 10).replace('-', '/') : '');
