/* ==========================================================================
   COLREG 3D — 3D scene & render engine  (STEP 2)
   --------------------------------------------------------------------------
   Three.js r185 (three@0.185.1). See the import map in index.html.

   Owns: renderer, camera, OrbitControls, sky, stars, the shader water plane,
   the day/night rig, and the camera→vessel relative-bearing calculation that
   drives the Aspect Angle Meter.

   COORDINATE CONVENTION (used by every other module)
     +Z = the vessel's bow          → relative bearing 000°
     +X = starboard                 → relative bearing 090°
     +Y = up; the sea surface is y = 0
   Relative bearing is therefore atan2(x, z), normalised to [0, 360).

   TRIANGLE BUDGET (~60k total)
     water 128×128 grid ......... 32 768   (64×64 = 8 192 in Lite FX)
     sky dome 24×16 ..............   768
     stars ...................... points, no triangles
     vessel + light cones ....... ~12 000  (STEP 3)
     leaves headroom for the simulator's second vessel (STEP 6).

   Three.js is imported DYNAMICALLY so that a blocked or cold CDN degrades to
   "3D unavailable" instead of taking the whole application down with it —
   the catalogue, the rule text and the quiz still work without WebGL.
   ========================================================================== */

let threePromise = null;

/** Memoised dynamic import, shared with lights.js and simulator.js. */
export function loadThree() {
  threePromise ??= (async () => {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    return { THREE, OrbitControls };
  })();
  return threePromise;
}

/* ── Tunables ──────────────────────────────────────────────────────────── */

const SEA_SIZE = 1600;              // metres across
const SEA_SEGMENTS = { full: 128, lite: 64 };
const FOG_NEAR = 120;
const FOG_FAR = 780;

const CAMERA = {
  fov: 42,
  near: 0.5,
  far: 4000,
  minDistance: 18,
  maxDistance: 420,
  /* Pitch lock: the eye may never reach or pass the sea surface plane.
     0.46π ≈ 82.8°, leaving a margin so the horizon stays visible. */
  maxPolarAngle: Math.PI * 0.46,
  minPolarAngle: Math.PI * 0.06,
  home: { radius: 95, polarDeg: 74, bearingDeg: 40 },
  targetHeight: 6                   // look at the superstructure, not the keel
};

const PALETTE = {
  night: {
    zenith: 0x030711, horizon: 0x0a1c2e, deep: 0x020509,
    fog: 0x060d18, sun: 0xaec6e8, sunIntensity: 0.22, ambient: 0.17, stars: 1
  },
  day: {
    zenith: 0x2f7fc4, horizon: 0xa9cbe4, deep: 0x0d3550,
    fog: 0x9dc0dc, sun: 0xfff3dd, sunIntensity: 1.55, ambient: 0.55, stars: 0
  }
};

/* ── Shaders ───────────────────────────────────────────────────────────── */

/* Four superposed directional waves. Deep-water dispersion (ω = √(g·k)) ties
   each wave's speed to its own length, which is what stops the surface from
   looking like a sliding texture. Normals are analytic — no derivative
   lookups, no extra passes. */
const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uChop;
  uniform vec4  uWaves[4];   // xy = direction, z = amplitude, w = wavelength

  varying vec3  vWorld;
  varying vec3  vNormal;
  varying float vDist;

  const float G = 9.81;

  void main() {
    vec3 pos = position;
    float h = 0.0;
    float dhdx = 0.0;
    float dhdz = 0.0;

    for (int i = 0; i < 4; i++) {
      vec2  dir = normalize(uWaves[i].xy);
      float amp = uWaves[i].z * uChop;
      float len = uWaves[i].w;
      float k   = 6.2831853 / len;
      float w   = sqrt(G * k);
      float phase = k * dot(dir, pos.xz) + uTime * w;

      h    += amp * sin(phase);
      float c = amp * k * cos(phase);
      dhdx += c * dir.x;
      dhdz += c * dir.y;
    }

    pos.y += h;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld  = world.xyz;
    vNormal = normalize(vec3(-dhdx, 1.0, -dhdz));
    vDist   = length(world.xyz - cameraPosition);

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAG = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uDeep;
  uniform vec3  uHorizon;
  uniform vec3  uFogColor;
  uniform vec3  uSunColor;
  uniform vec3  uSunDir;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSpecular;
  uniform float uDayMix;

  varying vec3  vWorld;
  varying vec3  vNormal;
  varying float vDist;

  const float G = 9.81;

  /* Ripples far too small to tessellate — a 12.5 m grid quad would smear the
     moon path into one blown-out streak. Perturbing the normal per pixel puts
     the glitter back for the cost of a few instructions and no triangles.
     Detail fades out with distance so it cannot alias near the horizon. */
  void addDetail(vec2 p, float t, inout float dhdx, inout float dhdz) {
    vec2  dirs[3];
    dirs[0] = vec2( 0.86,  0.51);
    dirs[1] = vec2(-0.42,  0.91);
    dirs[2] = vec2( 0.31, -0.95);

    float amps[3];
    amps[0] = 0.038; amps[1] = 0.023; amps[2] = 0.013;

    float lens[3];
    lens[0] = 7.3; lens[1] = 4.1; lens[2] = 2.2;

    for (int i = 0; i < 3; i++) {
      float k = 6.2831853 / lens[i];
      float w = sqrt(G * k);
      float c = amps[i] * k * cos(k * dot(dirs[i], p) + t * w);
      dhdx += c * dirs[i].x;
      dhdz += c * dirs[i].y;
    }
  }

  void main() {
    float fade = 1.0 - smoothstep(70.0, 420.0, vDist);

    float dx = 0.0;
    float dz = 0.0;
    if (fade > 0.001) addDetail(vWorld.xz, uTime, dx, dz);

    vec3 N = normalize(vec3(vNormal.x - dx * fade, vNormal.y, vNormal.z - dz * fade));
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSunDir);

    // Schlick-style fresnel: grazing angles turn to sky, steep ones to depth.
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    fres = mix(0.04, 1.0, fres);

    vec3 col = mix(uDeep, uHorizon, fres);

    // Sun/moon glitter path.
    vec3  H    = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), mix(420.0, 150.0, uDayMix));
    col += uSunColor * spec * uSpecular;

    // Subtle sub-surface lift on wave backs, daytime only.
    float lambert = max(dot(N, L), 0.0);
    col += uHorizon * lambert * 0.06 * uDayMix;

    float fog = smoothstep(uFogNear, uFogFar, vDist);
    col = mix(col, uFogColor, fog);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  precision mediump float;
  uniform vec3  uZenith;
  uniform vec3  uHorizon;
  uniform vec3  uFogColor;
  uniform vec3  uSunColor;
  uniform vec3  uSunDir;
  uniform float uDayMix;
  varying vec3  vDir;

  void main() {
    float h = clamp(vDir.y * 1.6 + 0.08, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.7));

    /* The sea fades to fog colour at its far edge, so the sky has to meet it
       in the same colour or a hard band appears along the horizon. */
    col = mix(uFogColor, col, smoothstep(-0.02, 0.16, vDir.y));

    // Glow around the sun/moon, tighter at night.
    float d = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += uSunColor * pow(d, mix(160.0, 24.0, uDayMix)) * mix(0.5, 0.9, uDayMix);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ── Helpers ───────────────────────────────────────────────────────────── */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const norm360 = (deg) => ((deg % 360) + 360) % 360;

/* ── Entry point ───────────────────────────────────────────────────────── */

/**
 * @param {{host: HTMLElement|null, bus: EventTarget, prefs: object}} ctx
 */
export async function initScene(ctx) {
  const { host, bus, prefs } = ctx;
  if (!host) return { pending: true, dispose() {} };

  let THREE, OrbitControls;
  try {
    ({ THREE, OrbitControls } = await loadThree());
  } catch (err) {
    console.error('[scene] Three.js failed to load', err);
    host.innerHTML =
      '<div class="placeholder" style="position:absolute;left:50%;top:50%;' +
      'transform:translate(-50%,-50%);max-width:min(400px,78%);text-align:center">' +
      '<p><strong>3D view unavailable</strong></p>' +
      '<p>Three.js could not be loaded. Connect once to complete the offline ' +
      'install — the catalogue and quiz still work.</p></div>';
    return { pending: true, failed: true, dispose() { host.innerHTML = ''; } };
  }

  host.innerHTML = '';

  /* ── Renderer ── */
  const lite = prefs?.perf === 'lite';
  const renderer = new THREE.WebGLRenderer({
    antialias: !lite,
    powerPreference: 'high-performance',
    stencil: false
  });
  renderer.setPixelRatio(lite ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth || 1, host.clientHeight || 1, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  host.append(renderer.domElement);

  /* ── Scene graph ── */
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.night.fog, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

  /** Vessel origin. STEP 3 fills this; bow points +Z. */
  const vesselAnchor = new THREE.Group();
  scene.add(vesselAnchor);

  /** Second vessel for the encounter simulator (STEP 6). */
  const targetAnchor = new THREE.Group();
  targetAnchor.visible = false;
  scene.add(targetAnchor);

  /* ── Lighting rig ── */
  const sunDir = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();

  const sun = new THREE.DirectionalLight(0xffffff, PALETTE.night.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(600);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0x9fc4e8, 0x0a1622, PALETTE.night.ambient);
  scene.add(hemi);

  /* ── Sky dome ── */
  const skyUniforms = {
    uZenith: { value: new THREE.Color(PALETTE.night.zenith) },
    uHorizon: { value: new THREE.Color(PALETTE.night.horizon) },
    uFogColor: { value: new THREE.Color(PALETTE.night.fog) },
    uSunColor: { value: new THREE.Color(PALETTE.night.sun) },
    uSunDir: { value: sunDir.clone() },
    uDayMix: { value: 0 }
  };
  const skyGeo = new THREE.SphereGeometry(2600, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  /* ── Stars ── */
  const STAR_COUNT = 900;
  const starPos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Upper hemisphere only, biased away from the horizon.
    const theta = Math.random() * Math.PI * 2;
    const y = Math.pow(Math.random(), 1.35);
    const r = Math.sqrt(1 - y * y);
    starPos[i * 3] = Math.cos(theta) * r * 2200;
    starPos[i * 3 + 1] = y * 2200;
    starPos[i * 3 + 2] = Math.sin(theta) * r * 2200;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xdfe9ff, size: 2.3, sizeAttenuation: false,
    transparent: true, opacity: 1, depthWrite: false, fog: false
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* ── Water ── */
  const waterUniforms = {
    uTime: { value: 0 },
    uChop: { value: 1 },
    uWaves: {
      value: [
        // direction.xy, amplitude (m), wavelength (m)
        new THREE.Vector4(1.0, 0.25, 0.62, 118),
        new THREE.Vector4(0.7, -0.7, 0.34, 67),
        new THREE.Vector4(-0.35, 0.9, 0.19, 41),
        new THREE.Vector4(0.15, 1.0, 0.09, 23)
      ]
    },
    uDeep: { value: new THREE.Color(PALETTE.night.deep) },
    uHorizon: { value: new THREE.Color(PALETTE.night.horizon) },
    uFogColor: { value: new THREE.Color(PALETTE.night.fog) },
    uSunColor: { value: new THREE.Color(PALETTE.night.sun) },
    uSunDir: { value: sunDir.clone() },
    uFogNear: { value: FOG_NEAR },
    uFogFar: { value: FOG_FAR },
    uSpecular: { value: 0.95 },
    uDayMix: { value: 0 }
  };

  let waterGeo = makeWaterGeometry(THREE, lite ? SEA_SEGMENTS.lite : SEA_SEGMENTS.full);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    fog: false
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  scene.add(water);

  /* ── Controls ── */
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.5;
  controls.enablePan = false;            // keeps the vessel centred as the subject
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = CAMERA.maxDistance;
  controls.minPolarAngle = CAMERA.minPolarAngle;
  controls.maxPolarAngle = CAMERA.maxPolarAngle;   // pitch lock — never below the sea
  controls.target.set(0, CAMERA.targetHeight, 0);

  // Tablet: one finger orbits, two fingers pinch-zoom.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

  resetCamera();

  /* ── Day / night blending ── */
  let dayMix = prefs?.daylight === 'day' ? 1 : 0;
  let dayTarget = dayMix;
  const cNight = {
    zenith: new THREE.Color(PALETTE.night.zenith),
    horizon: new THREE.Color(PALETTE.night.horizon),
    deep: new THREE.Color(PALETTE.night.deep),
    fog: new THREE.Color(PALETTE.night.fog),
    sun: new THREE.Color(PALETTE.night.sun)
  };
  const cDay = {
    zenith: new THREE.Color(PALETTE.day.zenith),
    horizon: new THREE.Color(PALETTE.day.horizon),
    deep: new THREE.Color(PALETTE.day.deep),
    fog: new THREE.Color(PALETTE.day.fog),
    sun: new THREE.Color(PALETTE.day.sun)
  };

  function applyDayMix(t) {
    skyUniforms.uZenith.value.copy(cNight.zenith).lerp(cDay.zenith, t);
    skyUniforms.uHorizon.value.copy(cNight.horizon).lerp(cDay.horizon, t);
    skyUniforms.uSunColor.value.copy(cNight.sun).lerp(cDay.sun, t);
    skyUniforms.uFogColor.value.copy(cNight.fog).lerp(cDay.fog, t);
    skyUniforms.uDayMix.value = t;

    waterUniforms.uDeep.value.copy(cNight.deep).lerp(cDay.deep, t);
    waterUniforms.uHorizon.value.copy(cNight.horizon).lerp(cDay.horizon, t);
    waterUniforms.uSunColor.value.copy(cNight.sun).lerp(cDay.sun, t);
    waterUniforms.uFogColor.value.copy(cNight.fog).lerp(cDay.fog, t);
    waterUniforms.uSpecular.value = lerp(0.95, 0.45, t);
    waterUniforms.uDayMix.value = t;

    scene.fog.color.copy(cNight.fog).lerp(cDay.fog, t);
    renderer.setClearColor(scene.fog.color, 1);

    sun.intensity = lerp(PALETTE.night.sunIntensity, PALETTE.day.sunIntensity, t);
    hemi.intensity = lerp(PALETTE.night.ambient, PALETTE.day.ambient, t);
    starMat.opacity = 1 - t;
    stars.visible = t < 0.98;
  }
  applyDayMix(dayMix);

  /* ── Camera helpers ── */

  function resetCamera() {
    lookFromBearing(CAMERA.home.bearingDeg, CAMERA.home.radius, CAMERA.home.polarDeg);
  }

  /**
   * Places the eye at a given relative bearing — used by the quiz to pose a
   * random aspect, and by the debug overlay to verify arc boundaries.
   */
  function lookFromBearing(bearingDeg, radius = CAMERA.home.radius, polarDeg = CAMERA.home.polarDeg) {
    const phi = THREE.MathUtils.degToRad(clamp(polarDeg, 8, 82));
    const theta = THREE.MathUtils.degToRad(norm360(bearingDeg));
    const r = clamp(radius, CAMERA.minDistance, CAMERA.maxDistance);

    const offset = new THREE.Vector3().setFromSphericalCoords(r, phi, theta);
    camera.position.copy(vesselAnchor.position).add(offset);
    camera.position.y += CAMERA.targetHeight;
    controls.target.copy(vesselAnchor.position).setY(CAMERA.targetHeight);
    controls.update();
  }

  const _local = new THREE.Vector3();

  /**
   * Relative bearing of the EYE as seen from the vessel: 000° dead ahead,
   * 090° starboard beam. Computed in the vessel's local frame, so it stays
   * correct when the simulator turns her.
   */
  function getBearing() {
    _local.copy(camera.position);
    vesselAnchor.worldToLocal(_local);
    return norm360(THREE.MathUtils.radToDeg(Math.atan2(_local.x, _local.z)));
  }

  function getRange() {
    return camera.position.distanceTo(vesselAnchor.getWorldPosition(_local));
  }

  /* ── Resize ── */
  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  /* ── Frame subscribers ── */
  const frameCbs = new Set();
  const onFrame = (cb) => { frameCbs.add(cb); return () => frameCbs.delete(cb); };

  /* ── Render loop ── */
  const clock = new THREE.Clock();
  let fpsFrames = 0;
  let fpsAccum = 0;
  let fps = 0;
  let running = true;

  // Reused each frame — no per-frame allocation in the hot path.
  const frameInfo = { dt: 0, elapsed: 0, bearing: 0, range: 0, fps: 0 };

  renderer.setAnimationLoop(() => {
    if (!running) return;

    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;

    waterUniforms.uTime.value = elapsed;

    if (dayMix !== dayTarget) {
      const step = dt / 1.1;
      dayMix = dayTarget > dayMix ? Math.min(dayTarget, dayMix + step)
                                  : Math.max(dayTarget, dayMix - step);
      applyDayMix(dayMix);
    }

    controls.update();

    // Belt-and-braces pitch lock: damping can overshoot maxPolarAngle by a
    // fraction of a degree, and the eye dipping under the sea reads as a bug.
    if (camera.position.y < 1.5) camera.position.y = 1.5;

    // Keep the sea and sky centred on the eye so their edges are never reached.
    water.position.x = camera.position.x;
    water.position.z = camera.position.z;
    sky.position.copy(camera.position);

    frameInfo.dt = dt;
    frameInfo.elapsed = elapsed;
    frameInfo.bearing = getBearing();
    frameInfo.range = getRange();
    frameInfo.fps = fps;
    for (const cb of frameCbs) cb(frameInfo);

    renderer.render(scene, camera);

    fpsFrames++;
    fpsAccum += dt;
    if (fpsAccum >= 0.5) {
      fps = fpsFrames / fpsAccum;
      fpsFrames = 0;
      fpsAccum = 0;
    }
  });

  /* ── External controls (driven by main.js via the bus) ── */

  function setDaylight(mode) { dayTarget = mode === 'day' ? 1 : 0; }

  function setPerf(mode) {
    const isLite = mode === 'lite';
    renderer.setPixelRatio(isLite ? 1 : Math.min(devicePixelRatio, 2));

    const segments = isLite ? SEA_SEGMENTS.lite : SEA_SEGMENTS.full;
    if (waterGeo.parameters?.widthSegments !== segments) {
      const next = makeWaterGeometry(THREE, segments);
      water.geometry = next;
      waterGeo.dispose();          // release the old grid, don't leak it
      waterGeo = next;
    }
    resize();
  }

  bus?.addEventListener('scene:daylight', (e) => setDaylight(e.detail.daylight));
  bus?.addEventListener('scene:perf', (e) => setPerf(e.detail.perf));
  bus?.addEventListener('camera:reset', () => resetCamera());

  /* ── Teardown ── */
  function dispose() {
    running = false;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    controls.dispose();
    frameCbs.clear();

    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });

    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer.domElement.remove();
  }

  return {
    pending: false,
    THREE, renderer, scene, camera, controls,
    vesselAnchor, targetAnchor,
    onFrame, resetCamera, lookFromBearing, getBearing, getRange,
    setDaylight, setPerf, dispose,
    get fps() { return fps; }
  };
}

/** Flat XZ grid, pre-rotated so the shader can use position.xz directly. */
function makeWaterGeometry(THREE, segments) {
  const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);
  geo.parameters = { widthSegments: segments };
  return geo;
}
