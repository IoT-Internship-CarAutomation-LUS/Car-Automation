# three.js r186 (vendored)

From the npm package `three@0.186.0` (MIT, see LICENSE). No CDN is used at runtime.

- `three.core.min.js`, `three.module.min.js`: `build/three.core.js` and `build/three.module.js`, minified with esbuild 0.24 (licence comment kept). The module's import of `./three.core.js` points at `./three.core.min.js`.
- `addons/OrbitControls.js`, `addons/RoundedBoxGeometry.js`, `addons/RoomEnvironment.js`: copied unchanged from `examples/jsm/`, except `from 'three'` became `from '../three.module.min.js'`, so no import map is needed.
