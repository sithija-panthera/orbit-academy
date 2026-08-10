import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { Sim } from './sim/sim.js';
import { DroneSim } from './sim/drone.js';
import { ArmSim } from './sim/arm.js';
import { OrbitSim } from './sim/orbit.js';
import { Runner } from './runner.js';
import { graph } from './ros/miniros.js';
import { LESSONS } from './lessons.js';
import { askTutor, getApiKey, setApiKey } from './ai/gemini.js';
import { getSession, recordCompletion } from './auth.js';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'javascript' || label === 'typescript') return new tsWorker();
    return new editorWorker();
  },
};

// ---------- console ----------
const consoleOut = document.getElementById('console-out');
const consoleLines = [];
function logLine(text, cls = 'log') {
  consoleLines.push(text);
  if (consoleLines.length > 400) consoleLines.shift();
  const div = document.createElement('div');
  div.className = `log-line ${cls}`;
  div.textContent = text;
  consoleOut.appendChild(div);
  while (consoleOut.children.length > 400) consoleOut.removeChild(consoleOut.firstChild);
  consoleOut.scrollTop = consoleOut.scrollHeight;
}
document.getElementById('btn-clear-console').addEventListener('click', () => {
  consoleOut.innerHTML = '';
  consoleLines.length = 0;
});

// ---------- editor ----------
const editor = monaco.editor.create(document.getElementById('editor'), {
  value: LESSONS[0].starterCode,
  language: 'javascript',
  theme: 'vs-dark',
  fontSize: 13,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
});

// ---------- runner ----------
const btnRun = document.getElementById('btn-run');
const btnStop = document.getElementById('btn-stop');
const btnReset = document.getElementById('btn-reset');
const hudStatus = document.getElementById('hud-status');
const hudTelemetry = document.getElementById('hud-telemetry');
const goalToast = document.getElementById('goal-toast');

const runner = new Runner({
  onLog: logLine,
  onError: () => { hudStatus.textContent = 'ERROR'; hudStatus.style.color = 'var(--red)'; },
  onStateChange: (running) => {
    btnRun.disabled = running;
    btnStop.disabled = !running;
    hudStatus.textContent = running ? 'CODE RUNNING' : 'SIM READY';
    hudStatus.style.color = running ? 'var(--accent)' : 'var(--green)';
    if (running) {
      goalState = {}; goalDone = false; goalToast.classList.add('hidden');
      runStartedAt = performance.now();
    }
  },
});
let runStartedAt = 0;

// account chip
const userChip = document.getElementById('user-chip');
function renderUserChip() {
  const session = getSession();
  userChip.textContent = session ? `◉ ${session.name}` : 'Sign in to save progress';
  userChip.classList.toggle('signed-in', !!session);
}
renderUserChip();

// ---------- lessons + sim lifecycle ----------
const lessonSelect = document.getElementById('lesson-select');
const lessonGoalEl = document.getElementById('lesson-goal');
for (const l of LESSONS) {
  const opt = document.createElement('option');
  opt.value = l.id;
  opt.textContent = l.title;
  lessonSelect.appendChild(opt);
}

let sim = null;
let currentLesson = null;
let goalState = {};
let goalDone = false;

async function loadLesson(lesson) {
  runner.stop();
  const platformChanged = !currentLesson || currentLesson.platform !== lesson.platform;
  currentLesson = lesson;
  lessonSelect.value = lesson.id;
  lessonGoalEl.textContent = lesson.goalText;
  goalState = {};
  goalDone = false;
  goalToast.classList.add('hidden');

  if (platformChanged) {
    if (sim) sim.dispose();
    const canvas = document.getElementById('sim-canvas');
    const PLATFORMS = { rover: Sim, drone: DroneSim, arm: ArmSim, orbit: OrbitSim };
    sim = new (PLATFORMS[lesson.platform] ?? Sim)(canvas);
    window.__oa.sim = sim;
    try {
      await sim.init();
      logLine(`${lesson.platform} simulation ready`, 'sys');
    } catch (e) {
      hudStatus.textContent = 'SIM FAILED TO START';
      hudStatus.style.color = 'var(--red)';
      logLine(`simulation failed to initialize: ${e.message}`, 'err');
      return;
    }
  } else {
    sim.reset();
  }
  sim.setGoal(lesson.goal);
  editor.setValue(lesson.starterCode);
  logLine(`lesson loaded: ${lesson.title}`, 'sys');
}

lessonSelect.addEventListener('change', () => {
  const lesson = LESSONS.find((l) => l.id === lessonSelect.value);
  if (lesson) loadLesson(lesson);
});

// Debug hook for automated tests (not part of the student API)
window.__oa = { sim: null, graph, runner, loadLesson: (id) => loadLesson(LESSONS.find((l) => l.id === id)) };

await loadLesson(LESSONS[0]);

// ---------- goal checker ----------
setInterval(() => {
  if (!runner.running || goalDone || !currentLesson?.check || !sim) return;
  const t = sim.telemetry;
  if (t.x === undefined) return;
  try {
    if (currentLesson.check(t, goalState)) {
      goalDone = true;
      goalToast.classList.remove('hidden');
      logLine(`🏁 GOAL COMPLETE — ${currentLesson.title}`, 'sys');
      const secs = (performance.now() - runStartedAt) / 1000;
      if (recordCompletion(currentLesson.id, secs)) {
        logLine(`progress saved (${secs.toFixed(1)}s)`, 'sys');
      } else {
        logLine('sign in on the Dashboard to save progress', 'sys');
      }
    }
  } catch (e) {
    logLine(`goal checker error: ${e.message}`, 'err');
    goalDone = true;
  }
}, 200);

// ---------- HUD telemetry ----------
setInterval(() => {
  const t = sim?.telemetry;
  if (!t || t.x === undefined) return;
  if (t.range !== undefined) {
    hudTelemetry.textContent =
      `range  ${t.range.toFixed(1)} m\n` +
      `relvel ${t.relVel.toFixed(2)} m/s\n` +
      `thrust ${t.cmdV.toFixed(3)} m/s²\n` +
      `Δv     ${t.fuel.toFixed(1)} m/s`;
    return;
  }
  const alt = t.alt !== undefined ? `alt   ${t.alt.toFixed(2)} m\n` : '';
  hudTelemetry.textContent =
    `pos   (${t.x.toFixed(2)}, ${t.z.toFixed(2)}) m\n` + alt +
    `yaw   ${(t.yaw * 180 / Math.PI).toFixed(1)}°\n` +
    `speed ${t.speed.toFixed(2)} m/s\n` +
    `cmd   v=${t.cmdV.toFixed(2)} w=${t.cmdW.toFixed(2)}\n` +
    (Number.isFinite(t.minRange) ? `lidar min ${t.minRange.toFixed(2)} m` : '');
}, 200);

// ---------- run buttons ----------
btnRun.addEventListener('click', () => runner.run(editor.getValue()));
btnStop.addEventListener('click', () => runner.stop());
btnReset.addEventListener('click', () => { runner.stop(); sim?.reset(); logLine('sim reset', 'sys'); });

// ---------- tabs ----------
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-body').forEach((b) => b.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
  });
}

// ---------- topics inspector ----------
const topicsList = document.getElementById('topics-list');
setInterval(() => {
  if (!document.getElementById('tab-topics').classList.contains('active')) return;
  topicsList.innerHTML = '';
  for (const t of graph.topics.values()) {
    const row = document.createElement('div');
    row.className = 'topic-row';
    const preview = t.lastMsg ? JSON.stringify(t.lastMsg, truncArrays).slice(0, 220) : '(no messages yet)';
    row.innerHTML = '<span class="topic-name"></span><span class="topic-rate"></span><div class="topic-msg"></div>';
    row.querySelector('.topic-name').textContent = `${t.name}  [${t.type ?? '?'}]`;
    row.querySelector('.topic-rate').textContent = `${t.hz} Hz · ${t.msgCount} msgs`;
    row.querySelector('.topic-msg').textContent = preview;
    topicsList.appendChild(row);
  }
}, 500);
function truncArrays(_, v) {
  if (Array.isArray(v) && v.length > 8) return [...v.slice(0, 8).map(fmtNum), `…+${v.length - 8}`];
  return fmtNum(v);
}
function fmtNum(v) {
  if (typeof v !== 'number') return v;
  if (!Number.isFinite(v)) return 'inf'; // Infinity would stringify to null
  return +v.toFixed(3);
}

// ---------- Robot tab: teach the URDF behind the current platform ----------
const robotInfo = document.getElementById('robot-info');
async function renderRobotTab() {
  const info = sim?.urdfInfo;
  robotInfo.innerHTML = '';
  if (!info) {
    const note = document.createElement('div');
    note.className = 'urdf-note';
    note.textContent = 'This platform uses a custom physics model — no standard URDF exists for it. ' +
      'The rover and arm lessons load real robot URDFs (Clearpath Husky, UR5); switch to one of those to explore the format.';
    robotInfo.appendChild(note);
    return;
  }
  const h = document.createElement('h3');
  h.textContent = info.name;
  const sub = document.createElement('div');
  sub.className = 'robot-sub';
  sub.textContent = `${info.path} — the same URDF format used by real ROS 2 robots`;
  robotInfo.append(h, sub);

  try {
    const src = await (await fetch(info.path)).text();
    // joint table parsed straight from the URDF source
    const joints = [...src.matchAll(/<joint name="([^"]+)" type="([^"]+)">([\s\S]*?)<\/joint>/g)];
    const table = document.createElement('table');
    table.className = 'joint-table';
    table.innerHTML = '<thead><tr><th>joint</th><th>type</th><th>axis</th><th>limits (rad)</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const [, name, type, body] of joints) {
      const axis = body.match(/<axis xyz="([^"]+)"/)?.[1] ?? '—';
      const lim = body.match(/lower="([^"]+)" upper="([^"]+)"/);
      const tr = document.createElement('tr');
      for (const val of [name, type, axis, lim ? `${(+lim[1]).toFixed(2)} … ${(+lim[2]).toFixed(2)}` : '—']) {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    robotInfo.appendChild(table);
    const pre = document.createElement('div');
    pre.className = 'urdf-source';
    pre.textContent = src;
    robotInfo.appendChild(pre);
  } catch (e) {
    robotInfo.append(Object.assign(document.createElement('div'),
      { className: 'urdf-note', textContent: `Could not load URDF: ${e.message}` }));
  }
}
document.querySelector('[data-tab="robot"]').addEventListener('click', renderRobotTab);

// ---------- AI tutor ----------
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const apiKeyInput = document.getElementById('api-key');
apiKeyInput.value = getApiKey();
document.getElementById('btn-save-key').addEventListener('click', () => {
  setApiKey(apiKeyInput.value);
  addMsg('bot', 'API key saved locally. Ask me anything about the robot, topics, or your code!');
});
const chatHistory = [];
function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}
addMsg('bot', "Hi! I'm your robotics tutor. Paste a free Gemini API key below to enable me, then ask things like “what is a topic?” or “why does my rover keep spinning?”");
let chatPending = false;
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = chatInput.value.trim();
  if (!q || chatPending) return;
  chatPending = true;
  chatInput.value = '';
  addMsg('user', q);
  const pending = addMsg('bot', '…thinking');
  try {
    const answer = await askTutor(chatHistory, q, {
      code: editor.getValue(),
      consoleTail: consoleLines.slice(-15).join('\n'),
      lesson: currentLesson ? `${currentLesson.title} — ${currentLesson.goalText}` : '',
    });
    pending.textContent = answer;
    chatHistory.push({ role: 'user', text: q }, { role: 'model', text: answer });
    if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);
  } catch (err) {
    pending.textContent = err.message === 'NO_KEY'
      ? 'No API key set — paste a free Gemini API key below (aistudio.google.com/apikey) and press Save.'
      : `Tutor error: ${err.message}`;
  } finally {
    chatPending = false;
  }
});
