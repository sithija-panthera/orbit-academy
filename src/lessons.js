// Lesson definitions: starter code, goal beacon, and an automatic goal checker.
// check(telemetry, state) runs ~5×/s while student code runs; return true = complete.

export const LESSONS = [
  {
    id: 'rover-1',
    title: 'Lesson 1 · Drive the Rover with /cmd_vel',
    platform: 'rover',
    goal: null,
    goalText: 'Explore: publish to /cmd_vel and read /scan. Travel 8 m without getting stuck.',
    check(t, state) {
      if (state.lastX !== undefined) {
        state.dist = (state.dist ?? 0) + Math.hypot(t.x - state.lastX, t.z - state.lastZ);
      }
      state.lastX = t.x; state.lastZ = t.z;
      return (state.dist ?? 0) > 8;
    },
    starterCode: `// Lesson 1: drive the rover with /cmd_vel — avoid obstacles with /scan.
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
`,
  },
  {
    id: 'rover-2',
    title: 'Lesson 2 · Navigate to the Beacon',
    platform: 'rover',
    goal: { x: 6, z: -5, radius: 0.9 },
    goalText: 'Drive into the orange beacon at odom (6, 5) using /odom heading control.',
    check(t) {
      return Math.hypot(t.x - 6, t.z - (-5)) < 0.9;
    },
    starterCode: `// Lesson 2: navigate to the beacon using odometry.
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
`,
  },
  {
    id: 'drone-1',
    title: 'Lesson 3 · Take Off and Hover',
    platform: 'drone',
    goal: { x: 0, y: 3, z: 0, radius: 0.6 },
    goalText: 'Take off and hold altitude 3 m (±0.4 m) for 4 seconds.',
    check(t, state) {
      if (Math.abs(t.alt - 3) < 0.4) {
        state.hold = (state.hold ?? 0) + 1;
      } else {
        state.hold = 0;
      }
      return state.hold >= 20; // 20 checks ≈ 4 s
    },
    starterCode: `// Lesson 3: take off and hover at 3 m.
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
`,
  },
  {
    id: 'drone-2',
    title: 'Lesson 4 · Fly Through the Ring',
    platform: 'drone',
    goal: { x: 6, y: 3.5, z: -3, radius: 1.0 },
    goalText: 'Fly through the orange ring near the tall tower at odom (6, 3, 3.5).',
    check(t) {
      return Math.hypot(t.x - 6, t.alt - 3.5, t.z - (-3)) < 1.0;
    },
    starterCode: `// Lesson 4: fly to the ring at /odom (x=6, y=3, z=3.5).
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
`,
  },
  {
    id: 'arm-1',
    title: 'Lesson 5 · Pick and Place (IK)',
    platform: 'arm',
    goal: null,
    goalText: 'Use inverse kinematics to pick the green cube and drop it in the orange zone.',
    check(t) {
      return !t.attached && !t.gripper &&
        Math.hypot(t.cubeX - t.dropZone.x, t.cubeZ - t.dropZone.z) < t.dropZone.radius &&
        t.cubeY < 0.12;
    },
    starterCode: `// Lesson 5: pick and place with a UR5 (driving 3 of its 6 joints).
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
`,
  },
  {
    id: 'orbit-1',
    title: 'Lesson 6 · Orbital Rendezvous',
    platform: 'orbit',
    goal: null,
    goalText: 'Dock with the target: close to <1.5 m range at <0.15 m/s using /cmd_thrust.',
    check(t) {
      return t.range < 1.5 && t.relVel < 0.15;
    },
    starterCode: `// Lesson 6: orbital rendezvous.
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
`,
  },
];
