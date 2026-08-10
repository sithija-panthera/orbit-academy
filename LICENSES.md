# Third-party robot model licenses

All robot models used by Orbit Academy are openly licensed. Verified 2026-08-10
against each upstream repository's package.xml / LICENSE file.

| Robot | Files | Source | License |
|---|---|---|---|
| Clearpath Husky A200 | `public/robots/husky/` (URDF trimmed from husky_description; DAE meshes verbatim) | github.com/husky/husky (`husky_description`) | BSD-3-Clause © Clearpath Robotics |
| Universal Robots UR5 | `public/robots/ur5/` (URDF flattened from ur_description xacro; DAE meshes verbatim, melodic-devel) | github.com/ros-industrial/universal_robot (`ur_description`) | BSD © ROS-Industrial / Universal Robots |
| Bitcraze Crazyflie 2.x | `public/robots/cf2/` (mesh verbatim) | github.com/utiasDSL/gym-pybullet-drones | MIT © University of Toronto Dynamic Systems Lab |

Application code (this repository): all first-party.
Libraries: three.js (MIT), Rapier (Apache-2.0), monaco-editor (MIT), urdf-loader (Apache-2.0), Vite (MIT).
