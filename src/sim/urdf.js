// Shared URDF loading: returns { robot, wrapper } where wrapper is a Y-up
// three.js group (URDF/ROS models are Z-up per REP-103) and robot is the
// urdf-loader object with .joints for driving joint values.
import * as THREE from 'three';
import URDFLoader from 'urdf-loader';

export function loadURDF(path) {
  return new Promise((resolve, reject) => {
    const loader = new URDFLoader();
    loader.load(path, (robot) => {
      robot.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      const zUpToYUp = new THREE.Group();
      zUpToYUp.rotation.x = -Math.PI / 2;
      zUpToYUp.add(robot);
      const wrapper = new THREE.Group();
      wrapper.add(zUpToYUp);
      resolve({ robot, wrapper });
    }, undefined, reject);
  });
}
