import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { Sim } from './sim/sim.js';
import { Runner } from './runner.js';
import { graph } from './ros/miniros.js';
import { askTutor, getApiKey, setApiKey } from './ai/gemini.js';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'javascript' || label === 'typescript') return new tsWorker();
    return new editorWorker();
  },
};

const STARTER_CODE = `// Lesson 1: drive the rover with /cmd_vel — avoid obstacles with /scan.
// This is the same node/topic pattern you'll use in real ROS 2.

const node = rcljs.create_node('obstacle_avoider');
const cmdPub = node.create_publisher('geometry_msgs/Twist', '/cmd_vel');

let latestScan = null;
node.create_subscription('sensor_msgs/LaserScan', '/scan', (scan) => {
  latestScan = scan;
});

node.create_timer(0.1, () => {
  const cmd = msgs.Twist();
  if (!latestScan) { cmdPub.publish(cmd); return; }

  // Forward is the middle of the scan (index 36 of 72). Check a frontal cone.
  const front = latestScan.ranges.slice(30, 43);
  const minFront = Math.min(...front);

  if (minFront < 1.2) {
    cmd.angular.z = 1.2;          // obstacle ahead: turn left
  } else {
    cmd.linear.x = 0.8;           // clear: cruise forward
  }
  cmdPub.publish(cmd);
});

node.get_logger().info('obstacle avoider started');
`;

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
  while (consoleOut.childNodes.length > 400) consoleOut.removeChild(consoleOut.firstChild);
  consoleOut.scrollTop = consoleOut.scrollHeight;
}
document.getElementById('btn-clear-console').addEventListener('click', () => {
  consoleOut.innerHTML = '';
  consoleLines.length = 0;
});

// ---------- editor ----------
const editor = monaco.editor.create(document.getElementById('editor'), {
  value: STARTER_CODE,
  language: 'javascript',
  theme: 'vs-dark',
  fontSize: 13,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
});

// ---------- sim ----------
const sim = new Sim(document.getElementById('sim-canvas'));
const hudStatus = document.getElementById('hud-status');
const hudTelemetry = document.getElementById('hud-telemetry');
try {
  await sim.init();
  logLine('simulation ready — physics engine initialized', 'sys');
} catch (e) {
  hudStatus.textContent = 'SIM FAILED TO START';
  hudStatus.style.color = 'var(--red)';
  logLine(`simulation failed to initialize: ${e.message}`, 'err');
}

setInterval(() => {
  const t = sim.telemetry;
  if (t.x === undefined) return;
  hudTelemetry.textContent =
    `pos   (${t.x.toFixed(2)}, ${t.z.toFixed(2)}) m\n` +
    `yaw   ${(t.yaw * 180 / Math.PI).toFixed(1)}°\n` +
    `speed ${t.speed.toFixed(2)} m/s\n` +
    `cmd   v=${t.cmdV.toFixed(2)} w=${t.cmdW.toFixed(2)}\n` +
    `lidar min ${isFinite(t.minRange) ? t.minRange.toFixed(2) + ' m' : '—'}`;
}, 200);

// ---------- runner ----------
const btnRun = document.getElementById('btn-run');
const btnStop = document.getElementById('btn-stop');
const btnReset = document.getElementById('btn-reset');
const runner = new Runner({
  onLog: logLine,
  onError: () => { hudStatus.textContent = 'ERROR'; hudStatus.style.color = 'var(--red)'; },
  onStateChange: (running) => {
    btnRun.disabled = running;
    btnStop.disabled = !running;
    hudStatus.textContent = running ? 'CODE RUNNING' : 'SIM READY';
    hudStatus.style.color = running ? 'var(--accent)' : 'var(--green)';
  },
});
btnRun.addEventListener('click', () => runner.run(editor.getValue()));
btnStop.addEventListener('click', () => runner.stop());
btnReset.addEventListener('click', () => { runner.stop(); sim.reset(); logLine('sim reset', 'sys'); });

// Debug hook for automated tests (not part of the student API)
window.__oa = { sim, graph, runner };

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

// ---------- AI tutor ----------
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const apiKeyInput = document.getElementById('api-key');
apiKeyInput.value = getApiKey();
document.getElementById('btn-save-key').addEventListener('click', () => {
  setApiKey(apiKeyInput.value);
  addMsg('bot', 'API key saved locally. Ask me anything about the rover, topics, or your code!');
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
