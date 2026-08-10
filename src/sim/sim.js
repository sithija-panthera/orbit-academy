// Physics simulation: Three.js rendering + Rapier rigid-body physics.
// A differential-drive rover with lidar, IMU and odometry, publishing on
// miniros topics: /scan, /odom, /imu — subscribing to /cmd_vel.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { graph, msgs } from '../ros/miniros.js';
import { loadURDF } from './urdf.js';
import { enhanceRendering } from './render.js';

// Clearpath Husky A200 geometry (matches public/robots/husky/husky.urdf)
const WHEEL_RADIUS = 0.1651;
const TRACK = 0.5708;     // wheel separation (z axis)
const WHEELBASE = 0.512;  // front-rear separation (x axis)
const MAX_WHEEL_SPEED = 30; // rad/s

export class Sim {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = true;
    this.cmdVel = { linear: 0, angular: 0 };
    this.telemetry = {};
  }

  async init() {
    await RAPIER.init();
    this._setupScene();
    this._setupPhysics();
    this._buildArena();
    this._buildRover();
    this._wireTopics();
    this._loop();
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e13);
    this.scene.fog = new THREE.Fog(0x0b0e13, 18, 40);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(4.2, 3.2, 4.2);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    enhanceRendering(this.renderer, this.scene);

    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x44557a, 0x2a2018, 0.9));

    this._disposed = false;
    const onResize = () => {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this._resizeObserver = new ResizeObserver(onResize);
    this._resizeObserver.observe(this.canvas);
    onResize();
  }

  _setupPhysics() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  _buildArena() {
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x232a35, roughness: 0.95 });
    const grid = new THREE.GridHelper(30, 30, 0x2e3a4d, 0x1b2230);
    grid.position.y = 0.001;
    this.scene.add(grid);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 30), groundMat);
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(15, 0.1, 15).setTranslation(0, -0.1, 0).setFriction(1.2));

    // Arena walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c3546, roughness: 0.8 });
    for (const [x, z, sx, sz] of [[0, -12, 24, 0.3], [0, 12, 24, 0.3], [-12, 0, 0.3, 24], [12, 0, 0.3, 24]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.8, sz), wallMat);
      wall.position.set(x, 0.4, z);
      wall.castShadow = wall.receiveShadow = true;
      this.scene.add(wall);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, 0.4, sz / 2).setTranslation(x, 0.4, z));
    }

    // Obstacles: crates and rocks
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.9 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x55606e, roughness: 1.0, flatShading: true });
    const rng = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      const x = (rng() - 0.5) * 20, z = (rng() - 0.5) * 20;
      if (Math.hypot(x, z) < 2.5) continue; // keep spawn clear
      if (rng() > 0.5) {
        const s = 0.4 + rng() * 0.5;
        const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
        crate.position.set(x, s / 2, z);
        crate.rotation.y = rng() * Math.PI;
        crate.castShadow = crate.receiveShadow = true;
        this.scene.add(crate);
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setTranslation(x, s / 2, z)
            .setRotation(quatFromYaw(crate.rotation.y)));
      } else {
        const r = 0.3 + rng() * 0.4;
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rockMat);
        rock.position.set(x, r * 0.7, z);
        rock.castShadow = rock.receiveShadow = true;
        this.scene.add(rock);
        this.world.createCollider(RAPIER.ColliderDesc.ball(r * 0.85).setTranslation(x, r * 0.7, z));
      }
    }
  }

  _buildRover() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dde5, roughness: 0.4, metalness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c222c, roughness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.5 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: 0.95 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x99a3b0, roughness: 0.3, metalness: 0.6 });

    // Chassis rigid body
    const spawnY = WHEEL_RADIUS + 0.02;
    this.chassisBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, spawnY, 0).setCanSleep(false));
    this.selfColliders = new Set(); // rover's own colliders — lidar must ignore these
    this.chassisCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.49, 0.12, 0.30).setDensity(320), this.chassisBody);
    this.selfColliders.add(this.chassisCollider.handle);

    // Chassis visual group
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.16, 0.52), bodyMat);
    hull.castShadow = true; g.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.4), darkMat);
    deck.position.y = 0.115; deck.castShadow = true; g.add(deck);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.03, 0.1), accentMat);
    stripe.position.y = 0.06; g.add(stripe);
    // Lidar puck on mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 12), hubMat);
    mast.position.set(0.1, 0.24, 0); g.add(mast);
    this.lidarPuck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 24), darkMat);
    this.lidarPuck.position.set(0.1, 0.36, 0); this.lidarPuck.castShadow = true; g.add(this.lidarPuck);
    const lidarRing = new THREE.Mesh(new THREE.CylinderGeometry(0.061, 0.061, 0.02, 24), accentMat);
    lidarRing.position.set(0.1, 0.36, 0); g.add(lidarRing);
    // Camera nub at front
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), darkMat);
    cam.position.set(0.42, 0.12, 0); g.add(cam);
    this.chassisMesh = g;
    this.scene.add(g);

    // Wheels: 4 dynamic cylinders on revolute joints (spin axis = z / lateral)
    this.wheels = [];
    const positions = [
      { x: WHEELBASE / 2, z: -TRACK / 2, side: 'left' },
      { x: WHEELBASE / 2, z: TRACK / 2, side: 'right' },
      { x: -WHEELBASE / 2, z: -TRACK / 2, side: 'left' },
      { x: -WHEELBASE / 2, z: TRACK / 2, side: 'right' },
    ];
    for (const p of positions) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, spawnY, p.z).setCanSleep(false));
      // cylinder in Rapier is y-axis aligned; rotate collider so axis is z
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const wheelCollider = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(0.05, WHEEL_RADIUS)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setDensity(300).setFriction(1.0), body);
      this.selfColliders.add(wheelCollider.handle);

      const params = RAPIER.JointData.revolute(
        { x: p.x, y: 0, z: p.z }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
      const joint = this.world.createImpulseJoint(params, this.chassisBody, body, true);
      joint.setContactsEnabled(false); // chassis and wheel colliders overlap slightly

      // Wheel visual: tire + hub + spokes
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.1, 28), tireMat);
      tire.rotation.x = Math.PI / 2; tire.castShadow = true; wg.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 16), hubMat);
      hub.rotation.x = Math.PI / 2; wg.add(hub);
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, WHEEL_RADIUS * 1.6, 0.02), hubMat);
        spoke.rotation.z = (s / 5) * Math.PI * 2;
        wg.add(spoke);
      }
      this.scene.add(wg);
      this.wheels.push({ body, joint, mesh: wg, side: p.side, spin: 0 });
    }

    // Swap in the real Clearpath Husky URDF model (procedural stays as fallback)
    this.urdfInfo = { name: 'Clearpath Husky A200', path: 'robots/husky/husky.urdf' };
    loadURDF(this.urdfInfo.path).then(({ robot, wrapper }) => {
      if (this._disposed) return;
      this.urdfRobot = robot;
      this.urdfWrapper = wrapper;
      // URDF base_link origin sits 0.03282 m below the wheel axles (physics chassis center)
      wrapper.children[0].position.y = -0.03282;
      this.scene.add(wrapper);
      // hide procedural hull + wheels; keep the lidar puck (sensor add-on) on the Husky top plate
      this.chassisMesh.visible = false;
      for (const w of this.wheels) w.mesh.visible = false;
      this.lidarPuck2 = this.lidarPuck.clone();
      const ring2 = new THREE.Mesh(new THREE.CylinderGeometry(0.061, 0.061, 0.02, 24),
        new THREE.MeshBasicMaterial({ color: 0xff6a2b }));
      this.lidarPuck2.position.set(0.1, 0.42, 0);
      ring2.position.copy(this.lidarPuck2.position);
      wrapper.add(this.lidarPuck2, ring2);
    }).catch((e) => console.warn('Husky URDF failed to load, using fallback model:', e));
  }

  // Optional glowing goal beacon, used by the lesson system.
  setGoal(goal) {
    if (this.goalMesh) { this.scene.remove(this.goalMesh); this.goalMesh = null; }
    this.goal = goal ?? null;
    if (!goal) return;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(goal.radius ?? 0.8, 0.05, 12, 40),
      new THREE.MeshBasicMaterial({ color: 0xff6a2b }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 4, 10),
      new THREE.MeshBasicMaterial({ color: 0xff6a2b, transparent: true, opacity: 0.35 }));
    beam.position.y = 2;
    g.add(beam);
    g.position.set(goal.x, 0, goal.z);
    this.goalMesh = g;
    this.scene.add(g);
  }

  dispose() {
    this._disposed = true;
    this._resizeObserver.disconnect();
    graph.topic('/cmd_vel').systemSubscribers.delete(this._cmdVelListener);
    this.renderer.dispose();
    this.world.free();
  }

  _wireTopics() {
    this._cmdVelListener = (msg) => {
      this.cmdVel.linear = clamp(msg?.linear?.x ?? 0, -1.5, 1.5);
      this.cmdVel.angular = clamp(msg?.angular?.z ?? 0, -3, 3);
    };
    graph.topic('/cmd_vel', 'geometry_msgs/Twist').systemSubscribers.add(this._cmdVelListener);
    this.scanTopic = graph.topic('/scan', 'sensor_msgs/LaserScan');
    this.odomTopic = graph.topic('/odom', 'nav_msgs/Odometry');
    this.imuTopic = graph.topic('/imu', 'sensor_msgs/Imu');
    this._lastSensorPub = 0;
  }

  reset() {
    this.cmdVel = { linear: 0, angular: 0 };
    const spawnY = WHEEL_RADIUS + 0.02;
    this.chassisBody.setTranslation({ x: 0, y: spawnY, z: 0 }, true);
    this.chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const positions = [
      [WHEELBASE / 2, -TRACK / 2], [WHEELBASE / 2, TRACK / 2],
      [-WHEELBASE / 2, -TRACK / 2], [-WHEELBASE / 2, TRACK / 2]];
    this.wheels.forEach((w, i) => {
      w.body.setTranslation({ x: positions[i][0], y: spawnY, z: positions[i][1] }, true);
      w.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      w.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      w.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
  }

  _applyDrive() {
    const { linear: v, angular: w } = this.cmdVel;
    // Negative sign: +ω about the +z axle rolls the body toward -x.
    const vLeft = -(v - w * TRACK / 2) / WHEEL_RADIUS;   // rad/s
    const vRight = -(v + w * TRACK / 2) / WHEEL_RADIUS;
    for (const wheel of this.wheels) {
      const target = clamp(wheel.side === 'left' ? vLeft : vRight, -MAX_WHEEL_SPEED, MAX_WHEEL_SPEED);
      wheel.joint.configureMotorVelocity(target, 1.5e4);
    }
    // Yaw-rate feedback, standing in for the onboard chassis velocity controller:
    // skid-steer scrub makes open-loop turning far under-rotate, exactly as on
    // real rovers, which close this loop with the IMU.
    const yawErr = w - this.chassisBody.angvel().y;
    this.chassisBody.applyTorqueImpulse({ x: 0, y: yawErr * 2.5, z: 0 }, true);
  }

  _publishSensors(now) {
    if (now - this._lastSensorPub < 100) return; // 10 Hz
    this._lastSensorPub = now;

    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    const lv = this.chassisBody.linvel();
    const av = this.chassisBody.angvel();

    // Yaw about world +y (correct even with roll/pitch on obstacles)
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const yaw = Math.atan2(-fwd.z, fwd.x);
    const speed = fwd.dot(new THREE.Vector3(lv.x, lv.y, lv.z));

    // Odometry in ROS REP-103 convention: x forward, y left, z up;
    // twist expressed in the body frame.
    const odom = msgs.Odometry();
    odom.pose.position = { x: t.x, y: -t.z, z: t.y };
    odom.pose.orientation = { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
    odom.twist.linear = { x: speed, y: 0, z: 0 };
    odom.twist.angular = { x: 0, y: 0, z: av.y };
    this.odomTopic.publish(odom);

    // IMU (body frame, REP-145 style; linear_acceleration omitted in v1)
    const imu = msgs.Imu();
    imu.orientation = odom.pose.orientation;
    imu.angular_velocity = { x: 0, y: 0, z: av.y };
    this.imuTopic.publish(imu);

    // Lidar: 72 rays, 360°, from the puck
    const scan = msgs.LaserScan();
    const N = 72;
    scan.angle_increment = (2 * Math.PI) / N;
    scan.angle_min = -Math.PI;
    scan.angle_max = Math.PI - scan.angle_increment; // angle of the final ray
    scan.range_min = 0.15;
    scan.range_max = 12;
    const origin = new THREE.Vector3(0.1, 0.36, 0).applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
    for (let i = 0; i < N; i++) {
      const a = scan.angle_min + i * scan.angle_increment;
      // angle measured from robot +x (forward), positive toward robot left (-z)
      const dirLocal = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      const dir = dirLocal.applyQuaternion(q);
      const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
      const hit = this.world.castRay(ray, scan.range_max, true, undefined, undefined, undefined, undefined,
        (collider) => !this.selfColliders.has(collider.handle));
      scan.ranges.push(hit ? Math.max(hit.timeOfImpact ?? hit.toi, scan.range_min) : Infinity);
    }
    this.scanTopic.publish(scan);

    // Telemetry for HUD
    const finiteRanges = scan.ranges.filter(Number.isFinite);
    this.telemetry = {
      x: t.x, z: t.z, yaw, speed,
      cmdV: this.cmdVel.linear, cmdW: this.cmdVel.angular,
      minRange: finiteRanges.length ? Math.min(...finiteRanges) : scan.range_max,
    };
  }

  _syncVisuals() {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    this.chassisMesh.position.set(t.x, t.y, t.z);
    this.chassisMesh.quaternion.set(r.x, r.y, r.z, r.w);
    for (const w of this.wheels) {
      const wt = w.body.translation(), wr = w.body.rotation();
      w.mesh.position.set(wt.x, wt.y, wt.z);
      w.mesh.quaternion.set(wr.x, wr.y, wr.z, wr.w);
    }
    if (this.urdfWrapper) {
      this.urdfWrapper.position.set(t.x, t.y, t.z);
      this.urdfWrapper.quaternion.set(r.x, r.y, r.z, r.w);
      // spin URDF wheel joints from each wheel body's lateral angular velocity
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const lat = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const names = ['front_left_wheel', 'front_right_wheel', 'rear_left_wheel', 'rear_right_wheel'];
      this.wheels.forEach((w, i) => {
        const av = w.body.angvel();
        w.spin -= (av.x * lat.x + av.y * lat.y + av.z * lat.z) / 60; // ROS +y = sim -z
        this.urdfRobot.joints[names[i]]?.setJointValue(w.spin);
      });
      if (this.lidarPuck2) this.lidarPuck2.rotation.y += 0.3;
    }
    this.lidarPuck.rotation.y += 0.3;

    // Chase camera
    const target = new THREE.Vector3(t.x, t.y + 0.3, t.z);
    const camGoal = new THREE.Vector3(t.x - 3.4, t.y + 2.6, t.z + 3.4);
    this.camera.position.lerp(camGoal, 0.04);
    this.camera.lookAt(target);
  }

  _loop() {
    // Fixed-timestep accumulator: physics runs at 60 Hz real time regardless
    // of display refresh rate (and yaw-feedback impulses stay per-step correct).
    const DT = 1 / 60;
    let last = performance.now();
    let acc = 0;
    const step = (now) => {
      if (this._disposed) return;
      requestAnimationFrame(step);
      acc += Math.min((now - last) / 1000, 0.25); // cap: no spiral after tab sleep
      last = now;
      if (this.running) {
        while (acc >= DT) {
          this._applyDrive();
          this.world.step();
          acc -= DT;
        }
        this._publishSensors(now);
      } else {
        acc = 0;
      }
      this._syncVisuals();
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(step);
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function quatFromYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
