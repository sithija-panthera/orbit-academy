import{n as e}from"./rolldown-runtime-Czjbc987.js";var t,n=e((()=>{t=[{id:`rover-1`,title:`Lesson 1 · Drive the Rover with /cmd_vel`,platform:`rover`,goal:null,goalText:`Explore: publish to /cmd_vel and read /scan. Travel 8 m without getting stuck.`,check(e,t){return t.lastX!==void 0&&(t.dist=(t.dist??0)+Math.hypot(e.x-t.lastX,e.z-t.lastZ)),t.lastX=e.x,t.lastZ=e.z,(t.dist??0)>8},starterCode:`// Lesson 1: drive the rover with /cmd_vel — avoid obstacles with /scan.
// Goal: travel 8 meters without getting stuck.
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
`},{id:`rover-2`,title:`Lesson 2 · Navigate to the Beacon`,platform:`rover`,goal:{x:6,z:-5,radius:.9},goalText:`Drive into the orange beacon at odom (6, 5) using /odom heading control.`,check(e){return Math.hypot(e.x-6,e.z- -5)<.9},starterCode:`// Lesson 2: navigate to the beacon using odometry.
// The beacon is at /odom position x=6, y=5  (ROS frame: y = -sim z, so it's ahead-left).
// Strategy: point at the goal, drive, avoid obstacles when the lidar complains.

const GOAL = { x: 6, y: 5 };
const node = rcljs.create_node('go_to_goal');
const cmdPub = node.create_publisher('geometry_msgs/Twist', '/cmd_vel');

let odom = null, scan = null;
node.create_subscription('nav_msgs/Odometry', '/odom', (m) => { odom = m; });
node.create_subscription('sensor_msgs/LaserScan', '/scan', (m) => { scan = m; });

node.create_timer(0.1, () => {
  const cmd = msgs.Twist();
  if (!odom) { cmdPub.publish(cmd); return; }

  const p = odom.pose.position;
  const q = odom.pose.orientation;
  const yaw = Math.atan2(2 * q.w * q.z, 1 - 2 * q.z * q.z);

  const bearing = Math.atan2(GOAL.y - p.y, GOAL.x - p.x);
  let err = bearing - yaw;
  while (err > Math.PI) err -= 2 * Math.PI;   // wrap to [-pi, pi]
  while (err < -Math.PI) err += 2 * Math.PI;

  const frontClear = !scan || Math.min(...scan.ranges.slice(31, 42)) > 1.0;

  if (!frontClear) {
    cmd.angular.z = 1.4;                       // dodge
  } else {
    cmd.angular.z = 1.8 * err;                 // P-controller on heading
    cmd.linear.x = Math.abs(err) < 0.5 ? 0.9 : 0.2;
  }
  cmdPub.publish(cmd);
});

node.get_logger().info('going to the beacon…');
`},{id:`drone-1`,title:`Lesson 3 · Take Off and Hover`,platform:`drone`,goal:{x:0,y:3,z:0,radius:.6},goalText:`Take off and hold altitude 3 m (±0.4 m) for 4 seconds.`,check(e,t){return t.hold=Math.abs(e.alt-3)<.4?(t.hold??0)+1:0,t.hold>=20},starterCode:`// Lesson 3: take off and hover at 3 m.
// The drone flies PX4-style "offboard velocity" commands on /cmd_vel:
//   linear.x/y = body-frame m/s,  linear.z = climb rate,  angular.z = yaw rate.
// Goal: hold altitude 3 m (±0.4 m) for 4 seconds.

const node = rcljs.create_node('hover_controller');
const cmdPub = node.create_publisher('geometry_msgs/Twist', '/cmd_vel');

let odom = null;
node.create_subscription('nav_msgs/Odometry', '/odom', (m) => { odom = m; });

node.create_timer(0.1, () => {
  const cmd = msgs.Twist();
  if (!odom) { cmdPub.publish(cmd); return; }

  const alt = odom.pose.position.z;      // REP-103: z is up
  const err = 3.0 - alt;
  cmd.linear.z = Math.max(-1.5, Math.min(1.5, 1.2 * err));  // P-controller on climb rate

  cmdPub.publish(cmd);
});

node.get_logger().info('taking off…');
`},{id:`drone-2`,title:`Lesson 4 · Fly Through the Ring`,platform:`drone`,goal:{x:6,y:3.5,z:-3,radius:1},goalText:`Fly through the orange ring near the tall tower at odom (6, 3, 3.5).`,check(e){return Math.hypot(e.x-6,e.alt-3.5,e.z- -3)<1},starterCode:`// Lesson 4: fly to the ring at /odom (x=6, y=3, z=3.5).
// Watch out for the tower next to it. 3D waypoint flying with two P-controllers.

const GOAL = { x: 6, y: 3, z: 3.5 };
const node = rcljs.create_node('ring_runner');
const cmdPub = node.create_publisher('geometry_msgs/Twist', '/cmd_vel');

let odom = null;
node.create_subscription('nav_msgs/Odometry', '/odom', (m) => { odom = m; });

node.create_timer(0.1, () => {
  const cmd = msgs.Twist();
  if (!odom) { cmdPub.publish(cmd); return; }

  const p = odom.pose.position;
  const q = odom.pose.orientation;
  const yaw = Math.atan2(2 * q.w * q.z, 1 - 2 * q.z * q.z);

  // climb first, then cruise
  cmd.linear.z = Math.max(-1.5, Math.min(1.5, 1.2 * (GOAL.z - p.z)));

  // yaw toward the goal, then fly forward
  const bearing = Math.atan2(GOAL.y - p.y, GOAL.x - p.x);
  let err = bearing - yaw;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  cmd.angular.z = 1.5 * err;

  const dist = Math.hypot(GOAL.x - p.x, GOAL.y - p.y);
  if (Math.abs(err) < 0.4 && Math.abs(GOAL.z - p.z) < 1.0) {
    cmd.linear.x = Math.min(2.0, 0.8 * dist);
  }
  cmdPub.publish(cmd);
});

node.get_logger().info('flying to the ring…');
`},{id:`arm-1`,title:`Lesson 5 · Pick and Place (IK)`,platform:`arm`,goal:null,goalText:`Use inverse kinematics to pick the green cube and drop it in the orange zone.`,check(e){return!e.attached&&!e.gripper&&Math.hypot(e.cubeX-e.dropZone.x,e.cubeZ-e.dropZone.z)<e.dropZone.radius&&e.cubeY<.12},starterCode:`// Lesson 5: pick and place with a UR5 (driving 3 of its 6 joints).
// Command joint angles on /joint_cmd: [yaw, shoulder, elbow] (radians).
// The gripper: publish 'close' / 'open' on /gripper_cmd.
// The cube sits at radius 0.55 m, yaw 0. The drop zone is at yaw +90°.

const node = rcljs.create_node('pick_and_place');
const jointPub = node.create_publisher('std_msgs/Float64MultiArray', '/joint_cmd');
const gripPub = node.create_publisher('std_msgs/String', '/gripper_cmd');

// --- 2-link inverse kinematics (this is the lesson!) ---
// r: horizontal reach from the base axis, h: height of the wrist ABOVE the shoulder.
// Returns [shoulder, elbow] angles, elbow-down.
const L1 = 0.425, L2 = 0.39225, SHOULDER_H = 0.35, HAND = 0.15;
function ik(r, wristY) {
  const h = wristY - SHOULDER_H;
  const d2 = r * r + h * h, d = Math.sqrt(d2);
  const cosE = (d2 - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const elbow = -(Math.PI - Math.acos(Math.max(-1, Math.min(1, cosE))));
  const alpha = Math.acos(Math.max(-1, Math.min(1, (d2 + L1 * L1 - L2 * L2) / (2 * L1 * d))));
  const shoulder = Math.atan2(h, r) + alpha;
  return [shoulder, elbow];
}

// waypoint sequence: [yaw, wrist r, wrist height, gripper, hold seconds]
const CUBE_R = 0.55, CUBE_TOP = 0.18 + HAND;
const steps = [
  [0,          CUBE_R, CUBE_TOP + 0.15, 'open',  1.2],  // hover above cube
  [0,          CUBE_R, CUBE_TOP,        'open',  2.0],  // descend
  [0,          CUBE_R, CUBE_TOP,        'close', 1.2],  // grab
  [0,          CUBE_R, CUBE_TOP + 0.2,  'close', 1.0],  // lift
  [Math.PI/2,  CUBE_R, CUBE_TOP + 0.2,  'close', 1.6],  // swing to the zone
  [Math.PI/2,  CUBE_R, 0.12 + HAND,     'close', 1.8],  // lower
  [Math.PI/2,  CUBE_R, 0.12 + HAND,     'open',  0.8],  // release
  [Math.PI/2,  CUBE_R, CUBE_TOP + 0.2,  'open',  1.0],  // retreat
];

let i = 0, elapsed = 0;
node.create_timer(0.1, () => {
  const [yaw, r, y, grip, hold] = steps[Math.min(i, steps.length - 1)];
  const [shoulder, elbow] = ik(r, y);
  jointPub.publish({ data: [yaw, shoulder, elbow] });
  gripPub.publish({ data: grip });
  elapsed += 0.1;
  if (elapsed >= hold && i < steps.length - 1) { i++; elapsed = 0; }
});

node.get_logger().info('pick-and-place sequence started');
`},{id:`orbit-1`,title:`Lesson 6 · Orbital Rendezvous`,platform:`orbit`,goal:null,goalText:`Dock with the target: close to <1.5 m range at <0.15 m/s using /cmd_thrust.`,check(e){return e.range<1.5&&e.relVel<.15},starterCode:`// Lesson 6: orbital rendezvous.
// You are 140 m from the target in the LVLH frame, governed by the real
// Clohessy–Wiltshire equations (x radial, y along-track, z cross-track).
// Command thrust acceleration on /cmd_thrust (m/s², clamped to ±0.5).
// Note: in orbit, thrusting toward the target is NOT always the fastest way there —
// watch how the trajectory curves. A PD controller fights the orbital dynamics for you.

const node = rcljs.create_node('rendezvous_gnc');
const thrustPub = node.create_publisher('geometry_msgs/Twist', '/cmd_thrust');

let state = null;
node.create_subscription('nav_msgs/Odometry', '/relative_state', (m) => { state = m; });

const KP = 0.0001, KD = 0.02;   // try changing these — what happens at KD = 0.002?

node.create_timer(0.1, () => {
  const cmd = msgs.Twist();
  if (state) {
    const p = state.pose.position;      // meters, LVLH
    const v = state.twist.linear;       // m/s
    cmd.linear.x = -KP * p.x - KD * v.x;
    cmd.linear.y = -KP * p.y - KD * v.y;
    cmd.linear.z = -KP * p.z - KD * v.z;
  }
  thrustPub.publish(cmd);
});

node.get_logger().info('guidance active — beginning approach');
`}]}));function r(){try{return JSON.parse(localStorage.getItem(d))??{}}catch{return{}}}function i(e){localStorage.setItem(d,JSON.stringify(e))}async function a(e){let t=await crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e));return[...new Uint8Array(t)].map(e=>e.toString(16).padStart(2,`0`)).join(``)}function o(){let e=localStorage.getItem(f);if(!e)return null;let t=r()[e];return t?{name:e,...t}:null}async function s(e,t){if(e=e.trim(),!/^[\w .-]{2,24}$/.test(e))throw Error(`Name must be 2–24 letters/numbers.`);if(t.length<4)throw Error(`Password must be at least 4 characters.`);let n=r();if(n[e])throw Error(`That name is already taken on this device.`);return n[e]={passHash:await a(t),created:Date.now(),progress:{}},i(n),localStorage.setItem(f,e),o()}async function c(e,t){e=e.trim();let n=r()[e];if(!n||n.passHash!==await a(t))throw Error(`Wrong name or password.`);return localStorage.setItem(f,e),o()}function l(){localStorage.removeItem(f)}function u(e,t){let n=localStorage.getItem(f);if(!n)return!1;let a=r(),o=a[n];if(!o)return!1;let s=o.progress[e];return o.progress[e]={completedAt:s?.completedAt??Date.now(),attempts:(s?.attempts??0)+1,bestTime:s?.bestTime?Math.min(s.bestTime,t):t},i(a),!0}var d,f,p=e((()=>{d=`oa-users`,f=`oa-session`}));export{u as a,n as c,l as i,p as n,s as o,c as r,t as s,o as t};