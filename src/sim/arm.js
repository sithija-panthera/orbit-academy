// 3-DOF + gripper manipulator. Links are rigid bodies chained by motorized
// revolute joints (position servos), so the arm obeys gravity, inertia and
// joint limits — students command joint angles like a real position-controlled arm.
// Topics: /joint_states (pub), /joint_cmd (sub, radians [yaw, shoulder, elbow]),
// /gripper_cmd (sub, {data: 'open'|'close'}).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { graph } from '../ros/miniros.js';
import { loadURDF } from './urdf.js';
import { enhanceRendering } from './render.js';

// Universal Robots UR5 kinematics (matches public/robots/ur5/ur5.urdf)
const L1 = 0.425;         // upper arm (a2)
const L2 = 0.39225;       // forearm (a3)
const HAND_DROP = 0.18;   // gripper hangs this far below the forearm tip
const SHOULDER_H = 0.35;  // shoulder pivot height
export const ARM_GEOM = { L1, L2, HAND_DROP, SHOULDER_H };

const CUBE_POS = { x: 0.55, y: 0.18, z: 0 };   // on a pedestal
const DROP_ZONE = { x: 0, z: -0.55, radius: 0.16 };

export class ArmSim {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = true;
    this.jointTargets = [0, 0.9, -1.4];
    this.gripperClosed = false;
    this.attached = false;
    this.telemetry = {};
  }

  async init() {
    await RAPIER.init();
    this._setupScene();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this._buildArena();
    this._buildArm();
    this._loadUR5();
    this._buildCube();
    this._wireTopics();
    this._loop();
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e13);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.camera.position.set(1.7, 1.4, 1.7);
    this.camera.lookAt(0, 0.35, 0);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    enhanceRendering(this.renderer, this.scene, { exposure: 1.15, envIntensity: 0.7 });
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
    sun.position.set(3, 6, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    for (const [k, v] of Object.entries({ left: -3, right: 3, top: 3, bottom: -3 })) sun.shadow.camera[k] = v;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x44557a, 0x2a2018, 0.8));

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
    const ground = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x232a35, roughness: 0.95 }));
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(new THREE.GridHelper(8, 16, 0x2e3a4d, 0x1b2230));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4).setTranslation(0, -0.1, 0));

    const pedMat = new THREE.MeshStandardMaterial({ color: 0x2c3546, roughness: 0.8 });
    // cube pedestal
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.15, 20), pedMat);
    ped.position.set(CUBE_POS.x, 0.075, CUBE_POS.z);
    ped.castShadow = ped.receiveShadow = true;
    this.scene.add(ped);
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.075, 0.12).setTranslation(CUBE_POS.x, 0.075, CUBE_POS.z));
    // drop zone marker
    const zone = new THREE.Mesh(new THREE.TorusGeometry(DROP_ZONE.radius, 0.02, 10, 32),
      new THREE.MeshBasicMaterial({ color: 0xff6a2b }));
    zone.rotation.x = Math.PI / 2;
    zone.position.set(DROP_ZONE.x, 0.02, DROP_ZONE.z);
    this.scene.add(zone);
  }

  _buildArm() {
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dde5, roughness: 0.35, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c222c, roughness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.5 });

    // Fixed base
    const baseBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.1, 0.16), baseBody);
    const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.2, 24), dark);
    baseMesh.position.y = 0.1;
    baseMesh.castShadow = true;
    this.scene.add(baseMesh);

    const mkLink = (desc, x, y, z) => this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(false)
        .setAngularDamping(2.0).setLinearDamping(0.5));

    // Yaw hub (rotates about y)
    this.hub = mkLink(null, 0, 0.27, 0);
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(0.07, 0.09).setDensity(600), this.hub);
    this.hubMesh = new THREE.Group();
    const hubCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 20), metal);
    this.hubMesh.add(hubCyl);
    const shoulderBlock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.14), accent);
    shoulderBlock.position.y = 0.1;
    this.hubMesh.add(shoulderBlock);
    this.scene.add(this.hubMesh);

    // Upper arm: box from shoulder (0, .35, 0) to elbow (L1, .35, 0)
    this.upper = mkLink(null, L1 / 2, SHOULDER_H, 0);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(L1 / 2, 0.045, 0.045).setDensity(400), this.upper);
    this.upperMesh = new THREE.Mesh(new THREE.BoxGeometry(L1, 0.09, 0.09), metal);
    this.upperMesh.castShadow = true;
    this.scene.add(this.upperMesh);

    // Forearm: elbow at (L1,.35,0) → tip (L1+L2,.35,0)
    this.fore = mkLink(null, L1 + L2 / 2, SHOULDER_H, 0);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(L2 / 2, 0.04, 0.04).setDensity(300), this.fore);
    this.foreMesh = new THREE.Group();
    const foreBox = new THREE.Mesh(new THREE.BoxGeometry(L2, 0.08, 0.08), metal);
    this.foreMesh.add(foreBox);
    const wristCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 16), accent);
    wristCyl.rotation.x = Math.PI / 2;
    wristCyl.position.x = L2 / 2;
    this.foreMesh.add(wristCyl);
    this.foreMesh.castShadow = true;
    this.scene.add(this.foreMesh);

    // Hand: separate body on a self-leveling wrist joint (servoed to stay vertical,
    // like the parallelogram linkage on real pick-and-place arms)
    this.hand = mkLink(null, L1 + L2, SHOULDER_H - HAND_DROP / 2, 0);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.03, HAND_DROP / 2, 0.03).setDensity(300), this.hand);
    this.handMesh = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06, HAND_DROP * 0.55, 0.06), metal);
    palm.position.y = HAND_DROP * 0.2;
    this.handMesh.add(palm);
    this.fingers = [];
    for (const side of [-1, 1]) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.025, HAND_DROP * 0.6, 0.02), dark);
      finger.position.set(0, -HAND_DROP * 0.2, side * 0.045);
      this.handMesh.add(finger);
      this.fingers.push({ mesh: finger, side });
    }
    this.handMesh.castShadow = true;
    this.scene.add(this.handMesh);

    // Joints
    this.jYaw = this.world.createImpulseJoint(
      // anchor is local to the base body (centered at y=0.1): 0.12 up = world 0.22
      RAPIER.JointData.revolute({ x: 0, y: 0.12, z: 0 }, { x: 0, y: -0.05, z: 0 }, { x: 0, y: 1, z: 0 }),
      baseBody, this.hub, true);
    this.jShoulder = this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0.08, z: 0 }, { x: -L1 / 2, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      this.hub, this.upper, true);
    this.jElbow = this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: L1 / 2, y: 0, z: 0 }, { x: -L2 / 2, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      this.upper, this.fore, true);
    this.jWrist = this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: L2 / 2, y: 0, z: 0 }, { x: 0, y: HAND_DROP / 2, z: 0 }, { x: 0, y: 0, z: 1 }),
      this.fore, this.hand, true);
    this.joints = [this.jYaw, this.jShoulder, this.jElbow, this.jWrist];
    // adjacent link colliders overlap at the joints — without this they jam
    for (const j of this.joints) j.setContactsEnabled(false);
  }

  _loadUR5() {
    this.urdfInfo = { name: 'Universal Robots UR5', path: 'robots/ur5/ur5.urdf' };
    loadURDF(this.urdfInfo.path).then(({ robot, wrapper }) => {
      if (this._disposed) return;
      this.urdfRobot = robot;
      // lab pedestal so the UR5 shoulder (0.089 m) lands at SHOULDER_H
      const standH = SHOULDER_H - 0.089159;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, standH, 24),
        new THREE.MeshStandardMaterial({ color: 0x2c3546, roughness: 0.7 }));
      stand.position.y = standH / 2;
      stand.castShadow = true;
      this.scene.add(stand);
      wrapper.position.y = standH;
      this.scene.add(wrapper);
      // hide the procedural links; keep base stand + gripper + cube
      this.hubMesh.visible = false;
      this.upperMesh.visible = false;
      this.foreMesh.visible = false;
    }).catch((e) => console.warn('UR5 URDF failed to load, using fallback model:', e));
  }

  // measured physics angles → UR5 joint values (UR sign convention: lift/elbow positive = down)
  _syncURDF() {
    if (!this.urdfRobot) return;
    const [yaw, sh, el] = this._jointAngles();
    const j = this.urdfRobot.joints;
    j.shoulder_pan_joint?.setJointValue(yaw);
    j.shoulder_lift_joint?.setJointValue(-sh);
    j.elbow_joint?.setJointValue(-el);
    j.wrist_1_joint?.setJointValue(Math.PI / 2 + sh + el);
    j.wrist_2_joint?.setJointValue(-Math.PI / 2);
    j.wrist_3_joint?.setJointValue(0);
  }

  _buildCube() {
    this.cube = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(CUBE_POS.x, CUBE_POS.y, CUBE_POS.z).setCanSleep(false));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.03, 0.03, 0.03).setDensity(400).setFriction(1.0), this.cube);
    this.cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.5 }));
    this.cubeMesh.castShadow = true;
    this.scene.add(this.cubeMesh);
  }

  _wireTopics() {
    this._jointCmdListener = (msg) => {
      const d = msg?.data;
      if (!Array.isArray(d) || d.length < 3) return;
      const lim = [[-Math.PI, Math.PI], [-0.2, 1.8], [-2.6, 0.2]];
      this.jointTargets = d.slice(0, 3).map((v, i) => clamp(+v || 0, lim[i][0], lim[i][1]));
    };
    this._gripperListener = (msg) => {
      this.gripperClosed = msg?.data === 'close';
      if (!this.gripperClosed) this._release();
    };
    graph.topic('/joint_cmd', 'std_msgs/Float64MultiArray').systemSubscribers.add(this._jointCmdListener);
    graph.topic('/gripper_cmd', 'std_msgs/String').systemSubscribers.add(this._gripperListener);
    this.jointStateTopic = graph.topic('/joint_states', 'sensor_msgs/JointState');
    this._lastSensorPub = 0;
  }

  reset() {
    this.jointTargets = [0, 0.9, -1.4];
    this.gripperClosed = false;
    this._release();
    this.cube.setTranslation(CUBE_POS, true);
    this.cube.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.cube.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.cube.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  dispose() {
    this._disposed = true;
    this._resizeObserver.disconnect();
    graph.topic('/joint_cmd').systemSubscribers.delete(this._jointCmdListener);
    graph.topic('/gripper_cmd').systemSubscribers.delete(this._gripperListener);
    this.renderer.dispose();
    this.world.free();
  }

  setGoal() { /* drop zone is always drawn */ }

  _jointAngles() {
    const q = (b) => { const r = b.rotation(); return new THREE.Quaternion(r.x, r.y, r.z, r.w); };
    const angleAbout = (qRel, axis) => {
      // twist angle of qRel about a local axis
      const v = new THREE.Vector3().copy(axis);
      const proj = new THREE.Vector3(qRel.x, qRel.y, qRel.z).dot(v);
      const twist = new THREE.Quaternion(v.x * proj, v.y * proj, v.z * proj, qRel.w).normalize();
      let a = 2 * Math.acos(Math.min(1, Math.abs(twist.w)));
      const sign = Math.sign(proj) * Math.sign(twist.w || 1);
      return a * (sign >= 0 ? 1 : -1);
    };
    const qHub = q(this.hub), qUp = q(this.upper), qFore = q(this.fore);
    const yaw = angleAbout(qHub.clone(), new THREE.Vector3(0, 1, 0));
    const shoulder = angleAbout(qHub.clone().invert().multiply(qUp), new THREE.Vector3(0, 0, 1));
    const elbow = angleAbout(qUp.clone().invert().multiply(qFore), new THREE.Vector3(0, 0, 1));
    return [yaw, shoulder, elbow];
  }

  _eePos() {
    // gripper midpoint: near the bottom of the hand body
    const h = this.hand.translation();
    const r = this.hand.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    return new THREE.Vector3(0, -HAND_DROP / 2 + 0.03, 0).applyQuaternion(q).add(new THREE.Vector3(h.x, h.y, h.z));
  }

  _grabCheck() {
    if (!this.gripperClosed || this.attached) return;
    const ee = this._eePos();
    const c = this.cube.translation();
    if (ee.distanceTo(new THREE.Vector3(c.x, c.y, c.z)) < 0.12) {
      this.attached = true;
    }
  }

  _release() { this.attached = false; }

  _applyControl() {
    // position servos: stiffness/damping tuned for gravity-loaded links
    this.jYaw.configureMotorPosition(this.jointTargets[0], 5e4, 4e3);
    this.jShoulder.configureMotorPosition(this.jointTargets[1], 4e6, 1.2e5);
    this.jElbow.configureMotorPosition(this.jointTargets[2], 1e6, 5e4);
    // self-leveling wrist: cancel the forearm's pitch so the gripper stays vertical
    const wristTarget = this.wristOverride ?? -(this.jointTargets[1] + this.jointTargets[2]);
    this.jWrist.configureMotorPosition(wristTarget, 5e4, 3e3);
    this._grabCheck();
    if (this.attached) {
      const ee = this._eePos();
      this.cube.setTranslation({ x: ee.x, y: ee.y, z: ee.z }, true);
      this.cube.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.cube.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  _publishSensors(now) {
    if (now - this._lastSensorPub < 100) return;
    this._lastSensorPub = now;
    const pos = [
      this.jYaw.angle?.() ?? this.jointTargets[0],
      this.jShoulder.angle?.() ?? this.jointTargets[1],
      this.jElbow.angle?.() ?? this.jointTargets[2],
    ];
    this.jointStateTopic.publish({
      name: ['yaw', 'shoulder', 'elbow'],
      position: pos,
      gripper: this.gripperClosed ? 'close' : 'open',
    });
    const ee = this._eePos();
    const c = this.cube.translation();
    this.telemetry = {
      x: ee.x, z: ee.z, alt: ee.y, yaw: pos[0],
      speed: 0,
      cmdV: this.jointTargets[1], cmdW: this.jointTargets[2],
      minRange: NaN,
      cubeX: c.x, cubeY: c.y, cubeZ: c.z,
      attached: this.attached,
      gripper: this.gripperClosed,
      dropZone: DROP_ZONE,
    };
  }

  _syncVisuals() {
    const sync = (body, mesh) => {
      const t = body.translation(), r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    };
    sync(this.hub, this.hubMesh);
    sync(this.upper, this.upperMesh);
    sync(this.fore, this.foreMesh);
    sync(this.hand, this.handMesh);
    sync(this.cube, this.cubeMesh);
    this._syncURDF();
    const gap = this.gripperClosed ? 0.028 : 0.045;
    for (const f of this.fingers) f.mesh.position.z = f.side * gap;
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
