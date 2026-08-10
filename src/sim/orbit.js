// Satellite rendezvous platform. Relative motion uses the real Clohessy–Wiltshire
// equations (LVLH frame, RK4-integrated) — the same linearized dynamics used for
// actual ISS rendezvous — with time warp so orbital timescales fit a lesson.
// LVLH frame: x = radial (away from Earth), y = along-track, z = cross-track.
// Topics: /relative_state (pub, Odometry: position/velocity in LVLH meters),
// /cmd_thrust (sub, Twist linear = commanded accel m/s², clamped to ±0.5).
import * as THREE from 'three';
import { graph, msgs } from '../ros/miniros.js';

const N = 0.00113;        // orbital rate rad/s (ISS-ish, ~92 min period)
const TIME_WARP = 40;     // sim seconds per wall second
const U_MAX = 0.5;        // thrust accel limit m/s²
const VIS_SCALE = 1 / 4;  // scene units per meter

export class OrbitSim {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = true;
    this.state = this._initialState();
    this.u = { x: 0, y: 0, z: 0 };
    this.telemetry = {};
    this.fuelUsed = 0; // Δv m/s
  }

  _initialState() {
    // start 140 m behind, 25 m below, 15 m out of plane, with a little drift
    return { x: -25, y: -140, z: 15, vx: 0.02, vy: 0.05, vz: -0.01 };
  }

  async init() {
    this._setupScene();
    this._buildWorld();
    this._wireTopics();
    this._loop();
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    const sun = new THREE.DirectionalLight(0xfff6e6, 3.0);
    sun.position.set(60, 20, 40);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x223044, 1.2));

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

  _buildWorld() {
    // starfield
    const starGeo = new THREE.BufferGeometry();
    const pts = new Float32Array(900 * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 1400;
    starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8fa3c0, size: 0.7, sizeAttenuation: false })));

    // Earth below (LVLH -x is toward Earth ⇒ scene -y)
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(400, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0x1d4d8f, roughness: 0.9, emissive: 0x0a1a30, emissiveIntensity: 0.6 }));
    earth.position.set(0, -430, 0);
    this.scene.add(earth);
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(404, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x4a90d9, transparent: true, opacity: 0.12, side: THREE.BackSide }));
    atmo.position.copy(earth.position);
    this.scene.add(atmo);

    const mkSat = (scale, accentColor) => {
      const g = new THREE.Group();
      const busMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.4, metalness: 0.5 });
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xb08d3f, roughness: 0.5, metalness: 0.7 });
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a2c66, roughness: 0.3, metalness: 0.4, emissive: 0x101d45, emissiveIntensity: 0.5 });
      const bus = new THREE.Mesh(new THREE.BoxGeometry(1.6 * scale, 1.2 * scale, 1.2 * scale), busMat);
      g.add(bus);
      const wrap = new THREE.Mesh(new THREE.BoxGeometry(1.0 * scale, 1.25 * scale, 1.25 * scale), goldMat);
      wrap.position.x = -0.3 * scale;
      g.add(wrap);
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05 * scale, 1.0 * scale, 3.4 * scale), panelMat);
        panel.position.z = side * 2.5 * scale;
        g.add(panel);
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * scale, 0.04 * scale, 1.6 * scale, 8), busMat);
        boom.rotation.x = Math.PI / 2;
        boom.position.z = side * 1.0 * scale;
        g.add(boom);
      }
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * scale, 0.4 * scale, 0.3 * scale, 20),
        new THREE.MeshStandardMaterial({ color: 0x2c3546, roughness: 0.6 }));
      port.rotation.z = Math.PI / 2;
      port.position.x = 0.95 * scale;
      g.add(port);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38 * scale, 0.05 * scale, 8, 24),
        new THREE.MeshBasicMaterial({ color: accentColor }));
      ring.rotation.y = Math.PI / 2;
      ring.position.x = 1.1 * scale;
      g.add(ring);
      return g;
    };

    // target at LVLH origin; its docking port faces -y (along-track, toward the chaser's approach)
    this.target = mkSat(2.2, 0xff6a2b);
    this.target.rotation.y = Math.PI / 2; // port toward -y_scene? port is +x local → rotate to face chaser
    this.scene.add(this.target);

    this.chaser = mkSat(1.2, 0x4ade80);
    this.scene.add(this.chaser);

    // thruster glow (scaled by |u|)
    this.plume = new THREE.Mesh(
      new THREE.ConeGeometry(0.25, 1.2, 12),
      new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0 }));
    this.chaser.add(this.plume);

    // approach corridor line to target
    const lineGeo = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]);
    this.rangeLine = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0x35507a, dashSize: 1, gapSize: 0.7 }));
    this.scene.add(this.rangeLine);
  }

  _wireTopics() {
    this._thrustListener = (msg) => {
      this.u = {
        x: clamp(msg?.linear?.x ?? 0, -U_MAX, U_MAX),
        y: clamp(msg?.linear?.y ?? 0, -U_MAX, U_MAX),
        z: clamp(msg?.linear?.z ?? 0, -U_MAX, U_MAX),
      };
    };
    graph.topic('/cmd_thrust', 'geometry_msgs/Twist').systemSubscribers.add(this._thrustListener);
    this.stateTopic = graph.topic('/relative_state', 'nav_msgs/Odometry');
    this._lastSensorPub = 0;
  }

  reset() {
    this.state = this._initialState();
    this.u = { x: 0, y: 0, z: 0 };
    this.fuelUsed = 0;
  }

  dispose() {
    this._disposed = true;
    this._resizeObserver.disconnect();
    graph.topic('/cmd_thrust').systemSubscribers.delete(this._thrustListener);
    this.renderer.dispose();
  }

  setGoal() { /* the docking ring is the goal */ }

  // Clohessy–Wiltshire dynamics (x radial, y along-track, z cross-track)
  _deriv(s, u) {
    return {
      x: s.vx, y: s.vy, z: s.vz,
      vx: 3 * N * N * s.x + 2 * N * s.vy + u.x,
      vy: -2 * N * s.vx + u.y,
      vz: -N * N * s.z + u.z,
    };
  }

  _rk4(dt) {
    const s = this.state, u = this.u;
    const add = (a, b, h) => ({
      x: a.x + b.x * h, y: a.y + b.y * h, z: a.z + b.z * h,
      vx: a.vx + b.vx * h, vy: a.vy + b.vy * h, vz: a.vz + b.vz * h,
    });
    const k1 = this._deriv(s, u);
    const k2 = this._deriv(add(s, k1, dt / 2), u);
    const k3 = this._deriv(add(s, k2, dt / 2), u);
    const k4 = this._deriv(add(s, k3, dt), u);
    this.state = {
      x: s.x + (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
      y: s.y + (dt / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
      z: s.z + (dt / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
      vx: s.vx + (dt / 6) * (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx),
      vy: s.vy + (dt / 6) * (k1.vy + 2 * k2.vy + 2 * k3.vy + k4.vy),
      vz: s.vz + (dt / 6) * (k1.vz + 2 * k2.vz + 2 * k3.vz + k4.vz),
    };
    this.fuelUsed += Math.hypot(u.x, u.y, u.z) * dt;
  }

  _publishSensors(now) {
    if (now - this._lastSensorPub < 100) return;
    this._lastSensorPub = now;
    const s = this.state;
    const odom = msgs.Odometry();
    odom.pose.position = { x: s.x, y: s.y, z: s.z };
    odom.twist.linear = { x: s.vx, y: s.vy, z: s.vz };
    this.stateTopic.publish(odom);

    const range = Math.hypot(s.x, s.y, s.z);
    const relVel = Math.hypot(s.vx, s.vy, s.vz);
    this.telemetry = {
      x: s.y, z: s.x, alt: s.z, yaw: 0,
      speed: relVel,
      cmdV: Math.hypot(this.u.x, this.u.y, this.u.z), cmdW: 0,
      minRange: NaN,
      range, relVel, fuel: this.fuelUsed,
    };
  }

  _syncVisuals() {
    const s = this.state;
    // LVLH → scene: x_scene = y (along-track), y_scene = x (radial up), z_scene = z
    const p = new THREE.Vector3(s.y * VIS_SCALE, s.x * VIS_SCALE, s.z * VIS_SCALE);
    this.chaser.position.copy(p);
    // point chaser docking port (+x local) toward the target
    this.chaser.lookAt(0, 0, 0);
    this.chaser.rotateY(-Math.PI / 2);
    const uMag = Math.hypot(this.u.x, this.u.y, this.u.z);
    this.plume.material.opacity = Math.min(0.7, uMag * 1.6);
    this.plume.position.set(-1.6, 0, 0);
    this.plume.rotation.z = Math.PI / 2;
    this.plume.scale.setScalar(0.6 + uMag);

    this.rangeLine.geometry.setFromPoints([p, new THREE.Vector3(0, 0, 0)]);
    this.rangeLine.computeLineDistances();

    this.target.rotation.y += 0.0004;

    // camera: over-the-shoulder of the chaser, looking at the target
    const range = Math.max(p.length(), 4);
    const camOffset = p.clone().normalize().multiplyScalar(range * 0.35 + 6).add(new THREE.Vector3(0, range * 0.12 + 2, 0));
    this.camera.position.lerp(p.clone().add(camOffset), 0.05);
    this.camera.lookAt(p.clone().multiplyScalar(0.4));
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
          // integrate warped sim-time in sub-steps for RK4 accuracy
          const simDt = DT * TIME_WARP;
          for (let i = 0; i < 4; i++) this._rk4(simDt / 4);
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
