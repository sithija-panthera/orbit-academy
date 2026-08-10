// Quadrotor platform. The rigid body flies purely on physics-engine forces;
// an onboard velocity controller (like PX4 offboard velocity mode) turns
// /cmd_vel body-frame velocity setpoints into thrust/torque commands.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { graph, msgs } from '../ros/miniros.js';
import { loadURDF } from './urdf.js';
import { enhanceRendering } from './render.js';

const MASS_ACCEL_XY = 6;   // max horizontal accel, m/s^2
const G = 9.81;

export class DroneSim {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = true;
    this.cmdVel = { vx: 0, vy: 0, vz: 0, wz: 0 }; // body-frame setpoints (ROS: x fwd, y left, z up)
    this.telemetry = {};
  }

  async init() {
    await RAPIER.init();
    this._setupScene();
    this.world = new RAPIER.World({ x: 0, y: -G, z: 0 });
    this._buildArena();
    this._buildDrone();
    this._wireTopics();
    this._loop();
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e13);
    this.scene.fog = new THREE.Fog(0x0b0e13, 25, 60);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(5, 4, 5);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    enhanceRendering(this.renderer, this.scene);
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(8, 16, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
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

  _buildArena() {
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x232a35, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), groundMat);
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(new THREE.GridHelper(40, 40, 0x2e3a4d, 0x1b2230));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.1, 20).setTranslation(0, -0.1, 0));

    // Landing pad
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.02, 32),
      new THREE.MeshStandardMaterial({ color: 0x2c3546 }));
    pad.position.y = 0.01;
    pad.receiveShadow = true;
    this.scene.add(pad);
    const padRing = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xff6a2b }));
    padRing.rotation.x = Math.PI / 2;
    padRing.position.y = 0.03;
    this.scene.add(padRing);

    // A few towers to fly around
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x2c3546, roughness: 0.8 });
    for (const [x, z, h] of [[6, -6, 5], [-7, 4, 3.5], [4, 7, 2.5]]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.4), towerMat);
      tower.position.set(x, h / 2, z);
      tower.castShadow = tower.receiveShadow = true;
      this.scene.add(tower);
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.7, h / 2, 0.7).setTranslation(x, h / 2, z));
    }
  }

  _buildDrone() {
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.03, 0).setCanSleep(false)
        .setLinearDamping(0.15).setAngularDamping(1.5));
    // Crazyflie 2.x scale: 92 mm motor-to-motor, 27 g
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.05, 0.015, 0.05).setDensity(90), this.body);
    this.mass = this.body.mass();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dde5, roughness: 0.4, metalness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c222c, roughness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.5 });

    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.24), bodyMat);
    hull.castShadow = true; g.add(hull);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), darkMat);
    dome.position.y = 0.05; g.add(dome);
    this.props = [];
    for (const [dx, dz] of [[0.19, 0.19], [0.19, -0.19], [-0.19, 0.19], [-0.19, -0.19]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(dx) * 1.6, 0.03, 0.04), darkMat);
      arm.position.set(dx / 2, 0, dz / 2);
      arm.rotation.y = Math.atan2(-dz, dx);
      arm.scale.x = Math.hypot(dx, dz) / Math.abs(dx);
      g.add(arm);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12), accentMat);
      motor.position.set(dx, 0.03, dz);
      g.add(motor);
      const prop = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.02), darkMat);
      prop.position.set(dx, 0.06, dz);
      g.add(prop);
      this.props.push(prop);
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), accentMat);
    nose.position.set(0.14, 0, 0);
    g.add(nose);
    g.scale.setScalar(0.4); // procedural fallback sized to Crazyflie-ish scale
    this.mesh = g;
    this.scene.add(g);

    // Swap in the real Bitcraze Crazyflie 2 model (MIT, gym-pybullet-drones)
    this.urdfInfo = { name: 'Bitcraze Crazyflie 2.x', path: 'robots/cf2/cf2.urdf' };
    loadURDF(this.urdfInfo.path).then(({ robot, wrapper }) => {
      if (this._disposed) return;
      this.urdfRobot = robot;
      this.urdfWrapper = wrapper;
      this.scene.add(wrapper);
      this.mesh.visible = false;
      this.props = []; // cf2 mesh has integrated props
    }).catch((e) => console.warn('Crazyflie URDF failed to load, using fallback model:', e));
  }

  setGoal(goal) {
    if (this.goalMesh) { this.scene.remove(this.goalMesh); this.goalMesh = null; }
    this.goal = goal ?? null;
    if (!goal) return;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(goal.radius ?? 1.0, 0.06, 12, 40),
      new THREE.MeshBasicMaterial({ color: 0xff6a2b }));
    ring.position.set(goal.x, goal.y, goal.z);
    ring.rotation.y = Math.PI / 4;
    this.goalMesh = ring;
    this.scene.add(ring);
  }

  _wireTopics() {
    this._cmdVelListener = (msg) => {
      this.cmdVel.vx = clamp(msg?.linear?.x ?? 0, -4, 4);
      this.cmdVel.vy = clamp(msg?.linear?.y ?? 0, -4, 4);
      this.cmdVel.vz = clamp(msg?.linear?.z ?? 0, -2.5, 2.5);
      this.cmdVel.wz = clamp(msg?.angular?.z ?? 0, -2, 2);
    };
    graph.topic('/cmd_vel', 'geometry_msgs/Twist').systemSubscribers.add(this._cmdVelListener);
    this.odomTopic = graph.topic('/odom', 'nav_msgs/Odometry');
    this.imuTopic = graph.topic('/imu', 'sensor_msgs/Imu');
    this._lastSensorPub = 0;
  }

  reset() {
    this.cmdVel = { vx: 0, vy: 0, vz: 0, wz: 0 };
    this.body.setTranslation({ x: 0, y: 0.03, z: 0 }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  dispose() {
    this._disposed = true;
    this._resizeObserver.disconnect();
    graph.topic('/cmd_vel').systemSubscribers.delete(this._cmdVelListener);
    this.renderer.dispose();
    this.world.free();
  }

  _applyControl() {
    const r = this.body.rotation();
    const lv = this.body.linvel();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const yaw = Math.atan2(-fwd.z, fwd.x);

    // Body-frame setpoint (ROS: +x fwd, +y left) → world frame:
    // body-x in world = (cos yaw, 0, -sin yaw); body-y (left) = up×fwd = (-sin yaw, 0, -cos yaw)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const vdes = new THREE.Vector3(
      this.cmdVel.vx * c + this.cmdVel.vy * -s,
      this.cmdVel.vz,
      this.cmdVel.vx * -s + this.cmdVel.vy * -c,
    );

    // Velocity controller → force (with gravity feed-forward), like PX4 offboard.
    const KV = 3.0;
    const ax = clamp(KV * (vdes.x - lv.x), -MASS_ACCEL_XY, MASS_ACCEL_XY);
    const az = clamp(KV * (vdes.z - lv.z), -MASS_ACCEL_XY, MASS_ACCEL_XY);
    let ay = KV * (vdes.y - lv.y) + G;
    ay = clamp(ay, 0, 2 * G); // rotors can't pull down; max thrust 2g
    // ay is total rotor thrust accel (includes +G feed-forward); the world
    // applies gravity itself, so hover ⇒ ay = G ⇒ net vertical accel 0.
    this.body.resetForces(true);
    this.body.addForce({ x: this.mass * ax, y: this.mass * ay, z: this.mass * az }, true);

    // Yaw-rate controller + attitude leveling (roll/pitch spring to flat)
    const av = this.body.angvel();
    // Attitude torques expressed as inertia-scaled angular accelerations:
    // τ = I·(k·err). Rate gains must satisfy k·dt < 1 for the explicit
    // integrator, so this stays stable from a 27 g Crazyflie to a 1.5 kg quad.
    const I = this.mass * 1.67e-3; // ≈ box inertia about any axis
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const levelAxis = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
    this.body.resetTorques(true);
    this.body.addTorque({
      x: I * (levelAxis.x * 25 - av.x * 8),
      y: I * 12 * (this.cmdVel.wz - av.y),
      z: I * (levelAxis.z * 25 - av.z * 8),
    }, true);

    this._lastAccel = { x: ax, z: az };
  }

  _publishSensors(now) {
    if (now - this._lastSensorPub < 100) return;
    this._lastSensorPub = now;
    const t = this.body.translation();
    const r = this.body.rotation();
    const lv = this.body.linvel();
    const av = this.body.angvel();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const yaw = Math.atan2(-fwd.z, fwd.x);

    const odom = msgs.Odometry();
    odom.pose.position = { x: t.x, y: -t.z, z: t.y };  // REP-103: z = altitude
    odom.pose.orientation = { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
    const c = Math.cos(yaw), s = Math.sin(yaw);
    odom.twist.linear = {                               // body frame
      x: lv.x * c - lv.z * s,
      y: -(lv.x * s + lv.z * c),
      z: lv.y,
    };
    odom.twist.angular = { x: 0, y: 0, z: av.y };
    this.odomTopic.publish(odom);

    const imu = msgs.Imu();
    imu.orientation = odom.pose.orientation;
    imu.angular_velocity = { x: 0, y: 0, z: av.y };
    this.imuTopic.publish(imu);

    this.telemetry = {
      x: t.x, z: t.z, alt: t.y, yaw,
      speed: Math.hypot(lv.x, lv.y, lv.z),
      cmdV: this.cmdVel.vx, cmdW: this.cmdVel.wz, cmdVz: this.cmdVel.vz,
      minRange: NaN,
    };
  }

  _syncVisuals() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    // visual tilt into the acceleration direction + spinning props
    if (this._lastAccel) {
      const tilt = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(clamp(this._lastAccel.z / G, -0.35, 0.35), 0, clamp(-this._lastAccel.x / G, -0.35, 0.35)));
      this.mesh.quaternion.multiply(tilt);
    }
    for (const p of this.props) p.rotation.y += 1.1;
    if (this.goalMesh) this.goalMesh.rotation.y += 0.02;

    if (this.urdfWrapper) {
      this.urdfWrapper.position.copy(this.mesh.position);
      this.urdfWrapper.quaternion.copy(this.mesh.quaternion);
    }
    const target = new THREE.Vector3(t.x, t.y + 0.03, t.z);
    const camGoal = new THREE.Vector3(t.x - 1.1, t.y + 0.65, t.z + 1.1);
    this.camera.position.lerp(camGoal, 0.05);
    this.camera.lookAt(target);
  }

  _loop() {
    const DT = 1 / 60;
    let last = performance.now();
    let acc = 0;
    const step = (now) => {
      if (this._disposed) return;
      requestAnimationFrame(step);
      acc += Math.min((now - last) / 1000, 0.25);
      last = now;
      if (this.running) {
        while (acc >= DT) {
          this._applyControl();
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
