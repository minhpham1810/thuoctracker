// Talks to the backend (see TEAM.md for routes). The URL is set on the login screen
// because the laptop's hotspot IP changes.
let base = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://192.168.1.10:8000';

export const setBaseUrl = (url) => { base = url.replace(/\/+$/, ''); };
export const getBaseUrl = () => base;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.json();
}

export const api = {
  doctors: () => call('GET', '/doctors'),
  patients: (doctorId) => call('GET', doctorId ? `/patients?doctor_id=${doctorId}` : '/patients'),
  medicines: (pid) => call('GET', `/patients/${pid}/medicines`),
  doses: (pid) => call('GET', `/patients/${pid}/doses`),
  alerts: () => call('GET', '/alerts'),
  cabinetState: (pid) => call('GET', `/cabinet/${pid}/state`),
  messages: (pid) => call('GET', `/patients/${pid}/messages`),
  sendMessage: (pid, msg) => call('POST', `/patients/${pid}/messages`, { patient_id: pid, ...msg }),
  registerPush: (role, userId, token) => call('POST', '/push/register', { role, user_id: userId, token }),
};

// Backend times are local and naive ("2026-10-24T15:01:50.9"), so slice instead of new Date().
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');
export const day = (iso) => (iso ? iso.slice(5, 10).replace('-', '/') : '');
