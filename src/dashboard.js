import { getSession, signUp, logIn, logOut } from './auth.js';
import { LESSONS } from './lessons.js';

const authPanel = document.getElementById('auth-panel');
const dashPanel = document.getElementById('dash-panel');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const authTitle = document.getElementById('auth-title');
const authSubmit = document.getElementById('auth-submit');
const authToggle = document.getElementById('auth-toggle');

let mode = 'login';

function render() {
  const session = getSession();
  authPanel.classList.toggle('hidden', !!session);
  dashPanel.classList.toggle('hidden', !session);
  if (!session) return;

  document.getElementById('dash-hello').textContent = `Welcome back, ${session.name}`;
  document.getElementById('dash-since').textContent =
    `pilot since ${new Date(session.created).toLocaleDateString()}`;

  const progress = session.progress ?? {};
  const done = LESSONS.filter((l) => progress[l.id]);
  const attempts = Object.values(progress).reduce((s, p) => s + (p.attempts ?? 0), 0);

  document.getElementById('stat-row').innerHTML = '';
  for (const [num, lbl] of [
    [`${done.length}/${LESSONS.length}`, 'missions complete'],
    [String(attempts), 'total runs'],
    [done.length === LESSONS.length ? 'ACE' : done.length >= 2 ? 'PILOT' : 'CADET', 'rank'],
  ]) {
    const el = document.createElement('div');
    el.className = 'stat';
    const n = document.createElement('div'); n.className = 'num'; n.textContent = num;
    const l = document.createElement('div'); l.className = 'lbl'; l.textContent = lbl;
    el.append(n, l);
    document.getElementById('stat-row').appendChild(el);
  }

  const list = document.getElementById('mission-list');
  list.innerHTML = '';
  for (const lesson of LESSONS) {
    const p = progress[lesson.id];
    const row = document.createElement('div');
    row.className = `mission ${p ? 'done' : ''}`;
    const check = document.createElement('span'); check.className = 'check'; check.textContent = p ? '◉' : '○';
    const title = document.createElement('div'); title.className = 'title';
    title.textContent = lesson.title;
    const topic = document.createElement('span'); topic.className = 'topic'; topic.textContent = lesson.goalText;
    title.appendChild(topic);
    const best = document.createElement('span'); best.className = 'best';
    best.textContent = p ? `best ${p.bestTime.toFixed(1)}s · ${p.attempts} runs` : 'not flown';
    const go = document.createElement('a'); go.className = 'go'; go.href = './app.html';
    go.textContent = p ? 'Fly again →' : 'Fly →';
    row.append(check, title, best, go);
    list.appendChild(row);
  }
}

authToggle.addEventListener('click', () => {
  mode = mode === 'login' ? 'signup' : 'login';
  authTitle.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  authSubmit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  authToggle.textContent = mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in';
  authError.textContent = '';
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const name = document.getElementById('auth-name').value;
  const pass = document.getElementById('auth-pass').value;
  try {
    if (mode === 'login') await logIn(name, pass);
    else await signUp(name, pass);
    render();
  } catch (err) {
    authError.textContent = err.message;
  }
});

document.getElementById('btn-logout').addEventListener('click', () => { logOut(); render(); });

render();
