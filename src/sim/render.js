// Shared rendering quality setup: filmic tone mapping + image-based lighting
// so PBR materials (robot metals, plastics) read realistically.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function enhanceRendering(renderer, scene, { exposure = 1.1, envIntensity = 0.55 } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  if ('environmentIntensity' in scene) scene.environmentIntensity = envIntensity;
  pmrem.dispose();
}
