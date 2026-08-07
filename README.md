# Orbit Academy

Browser-based robotics education platform: students learn robotics, ROS 2 concepts,
and AI/ML by writing code against real physics simulations — all client-side, $0/user.

## Stack
- **Vite** dev/build
- **Three.js** rendering, **Rapier** (WASM) rigid-body physics
- **Monaco** code editor
- **miniros** (`src/ros/miniros.js`) — faithful rclpy-style API emulation: nodes,
  publishers, subscriptions, timers, topic inspector. Student code transfers 1:1 to ROS 2.
- **Gemini tutor** (`src/ai/gemini.js`) — student pastes their own free API key
  (stored in localStorage); tutor sees their code + console output.

## Run
```sh
npm install
npx vite            # http://localhost:5173
```

## Architecture
- `src/sim/sim.js` — arena + differential-drive rover (4 motorized wheels via revolute
  joints, yaw-rate feedback standing in for the onboard velocity controller), lidar
  (72-ray castRay scan), odometry + IMU published at 10 Hz on `/scan` `/odom` `/imu`;
  subscribes `/cmd_vel`.
- `src/runner.js` — runs student JS with `rcljs`/`msgs` in scope; Stop destroys nodes
  and zeroes `/cmd_vel`. Sim-internal listeners live in `topic.systemSubscribers` and
  survive resets.
- `tools/shot.mjs`, `tools/drivetest.mjs` — Playwright validation harnesses
  (screenshots + physics assertions).

## Conventions
- y-up; robot forward = +x; positive `angular.z` = turn left (matches ROS REP-103 yaw sense).
- Lidar: index 0 = rear (−π), middle index = forward, angles increase toward robot left.

## Roadmap
- Lesson system (curriculum JSON + goal checkers), more platforms (arm, drone, underwater),
  Pyodide for Python, TF.js in-browser RL lesson, deploy as static site (Vercel/Netlify).
