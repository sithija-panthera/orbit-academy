// Client-side account + progress store (v1, zero-backend).
// Accounts live in this browser's localStorage; the API surface is designed so
// a Supabase/Firebase backend can replace the internals without touching callers.
const USERS_KEY = 'oa-users';
const SESSION_KEY = 'oa-session';

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) ?? {}; } catch { return {}; }
}
function saveUsers(users) { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }

async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getSession() {
  const name = localStorage.getItem(SESSION_KEY);
  if (!name) return null;
  const user = loadUsers()[name];
  return user ? { name, ...user } : null;
}

export async function signUp(name, password) {
  name = name.trim();
  if (!/^[\w .-]{2,24}$/.test(name)) throw new Error('Name must be 2–24 letters/numbers.');
  if (password.length < 4) throw new Error('Password must be at least 4 characters.');
  const users = loadUsers();
  if (users[name]) throw new Error('That name is already taken on this device.');
  users[name] = { passHash: await hash(password), created: Date.now(), progress: {} };
  saveUsers(users);
  localStorage.setItem(SESSION_KEY, name);
  return getSession();
}

export async function logIn(name, password) {
  name = name.trim();
  const users = loadUsers();
  const user = users[name];
  if (!user || user.passHash !== (await hash(password))) throw new Error('Wrong name or password.');
  localStorage.setItem(SESSION_KEY, name);
  return getSession();
}

export function logOut() { localStorage.removeItem(SESSION_KEY); }

export function recordCompletion(lessonId, seconds) {
  const name = localStorage.getItem(SESSION_KEY);
  if (!name) return false;
  const users = loadUsers();
  const user = users[name];
  if (!user) return false;
  const prev = user.progress[lessonId];
  user.progress[lessonId] = {
    completedAt: prev?.completedAt ?? Date.now(),
    attempts: (prev?.attempts ?? 0) + 1,
    bestTime: prev?.bestTime ? Math.min(prev.bestTime, seconds) : seconds,
  };
  saveUsers(users);
  return true;
}

export function getProgress() {
  return getSession()?.progress ?? {};
}
