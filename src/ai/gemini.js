// Gemini tutor integration. The student supplies their own API key (free tier),
// stored in localStorage — no backend needed.
const MODEL = 'gemini-2.0-flash';
const KEY_STORAGE = 'orbit-academy-gemini-key';

export function getApiKey() { return localStorage.getItem(KEY_STORAGE) ?? ''; }
export function setApiKey(k) { localStorage.setItem(KEY_STORAGE, k.trim()); }

const SYSTEM_PROMPT = `You are a friendly robotics tutor inside "Orbit Academy", a browser
robotics simulator. The student writes JavaScript against a ROS 2-style API called rcljs:
- const node = rcljs.create_node('name')
- node.create_publisher(type, '/topic') → pub.publish(msg)
- node.create_subscription(type, '/topic', cb)
- node.create_timer(periodSec, cb)
- msgs.Twist() / msgs.LaserScan() / msgs.Odometry() / msgs.Imu() build empty messages.
Platforms: a ROVER (subscribes /cmd_vel — linear.x m/s forward, angular.z rad/s yaw-left;
publishes /scan with 72 rays over 360° where index 0 = rear and the middle = forward,
plus /odom and /imu at 10 Hz, ROS REP-103 body-frame conventions) and a DRONE
(PX4-offboard-style /cmd_vel: linear.x/y body-frame m/s, linear.z climb rate,
angular.z yaw rate; publishes /odom where position.z is altitude, and /imu).
Explain concepts simply, use short answers, give hints before
full solutions, and relate concepts to real ROS 2 so knowledge transfers.`;

export async function askTutor(history, question, context) {
  const key = getApiKey();
  if (!key) throw new Error('NO_KEY');

  const contents = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));
  contents.push({
    role: 'user',
    parts: [{
      text: `${question}\n\n--- current lesson ---\n${context.lesson ?? ''}\n--- current student code ---\n${context.code}\n--- recent console output ---\n${context.consoleTail}`,
    }],
  });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      // key in a header, not the URL — query strings land in logs/history
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes('API key not valid')) {
      throw new Error('That API key was rejected — double-check it at aistudio.google.com/apikey.');
    }
    if (res.status === 429) {
      throw new Error('Rate limit reached on the free tier — wait a minute and try again.');
    }
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) {
    const reason = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason;
    throw new Error(reason ? `No answer returned (${reason})` : 'Empty response from Gemini');
  }
  return text;
}
