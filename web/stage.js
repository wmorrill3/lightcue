// The 3D stage: a night lot, the car, and every lamp driven by the emulated show.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { L, BAR, RGB } from '../engine/channels.js';

const WHITE = new THREE.Color(0xeaf2ff), AMBER = new THREE.Color(0xffa020), RED = new THREE.Color(0xff1414), WARM = new THREE.Color(0xfff1dc);

// lamp layout on the car (car faces +Z; its left side is +X). [left, right] channels map to +X / -X.
// strip: { x0, x1, y } across the face; dot: { x, y } ; side: { z, y } on the flank. face: 'front' | 'rear' | 'side'
// per-car geometry: heights of the light rows (m) and lateral extents, found by inspecting each model
export const CAR_GEOM = {
  roadster: { url: '/models/roadster.glb', sig: 0.47, head: 0.445, row: 0.43, fog: 0.2, aux: 0.4, marker: [1.85, 0.42], repeater: [1.15, 0.55], tail: 0.62, rearTurn: 0.6, brake: 0.57, reverse: 0.33, rearFog: 0.3, plate: 0.4, port: [-1.45, 0.6], cabin: [0.8, -0.05, 0.75, -0.55], halfW: 0.85, belly: 0.14, thrusters: [[0.55, 1.25], [-0.55, 1.25], [0.55, -1.2], [-0.55, -1.2]] },
  sedan: { url: '/models/sedan.glb', sig: 0.66, head: 0.6, row: 0.62, fog: 0.3, aux: 0.55, marker: [2.0, 0.6], repeater: [1.3, 0.8], tail: 0.85, rearTurn: 0.83, brake: 0.88, reverse: 0.45, rearFog: 0.35, plate: 0.6, port: [-1.75, 0.85], cabin: [1.0, 0.2, 1.0, -0.7], halfW: 0.92 },
  truck: { url: '/models/truck.glb', sig: 1.07, head: 1.0, row: 1.02, fog: 0.62, aux: 0.95, marker: [2.4, 0.9], repeater: [1.6, 1.0], tail: 1.33, rearTurn: 1.31, brake: 1.36, reverse: 0.55, rearFog: 0.5, plate: 0.58, port: [-2.1, 1.0], cabin: [1.3, 0.3, 1.3, -0.6], halfW: 1.05 },
  crossover: { url: '/models/car.glb', sig: 0.865, head: 0.765, row: 0.815, fog: 0.38, aux: 0.7, marker: [2.05, 0.66], repeater: [1.38, 0.9], tail: 1.0, rearTurn: 0.955, brake: 1.43, reverse: 0.42, rearFog: 0.37, plate: 0.64, port: [-1.72, 0.97], cabin: [1.12, 0.25, 1.1, -0.9], halfW: 1 },
};

function layout(G = CAR_GEOM.crossover) {
  const P = [];
  const k = G.halfW; // scale lateral positions to the body width
  const pair = (chs, def) => { P.push({ ...def, ch: chs[0], sx: 1 }); P.push({ ...def, ch: chs[1], sx: -1 }); };
  pair(L.signature, { face: 'front', strip: [0.05 * k, 0.93 * k], y: G.sig, n: 30, color: WHITE, w: 0.022, bar: 'front' });
  pair(L.ch4, { face: 'front', strip: [0.72 * k, 0.9 * k], y: G.row, n: 5, color: WHITE, w: 0.014 });
  pair(L.ch5, { face: 'front', strip: [0.56 * k, 0.7 * k], y: G.row, n: 4, color: WHITE, w: 0.014 });
  pair(L.ch6, { face: 'front', strip: [0.4 * k, 0.54 * k], y: G.row, n: 4, color: WHITE, w: 0.014 });
  pair(L.outer, { face: 'front', dot: [0.83 * k, G.head], r: 0.05, color: WHITE, beam: true });
  pair(L.inner, { face: 'front', dot: [0.64 * k, G.head], r: 0.045, color: WHITE, beam: true });
  pair(L.frontTurn, { face: 'front', strip: [0.9 * k, 0.99 * k], y: G.sig - 0.005, n: 3, color: AMBER, w: 0.03 });
  pair(L.fog, { face: 'front', strip: [0.94 * k, 0.99 * k], y: G.fog, n: 2, color: WHITE, w: 0.09, vertical: true });
  pair(L.auxPark, { face: 'front', dot: [0.9 * k, G.aux], r: 0.025, color: WARM });
  pair(L.sideMarker, { face: 'side', side: G.marker, r: 0.03, color: AMBER });
  pair(L.repeater, { face: 'side', side: G.repeater, r: 0.03, color: AMBER });
  pair(L.tail, { face: 'rear', strip: [0.42 * k, 0.97 * k], y: G.tail, n: 26, color: RED, w: 0.03, bar: 'rear' });
  pair(L.rearTurn, { face: 'rear', strip: [0.88 * k, 0.99 * k], y: G.rearTurn, n: 3, color: AMBER, w: 0.022 });
  P.push({ face: 'rear', strip: [-0.32 * k, 0.32 * k], y: G.brake, n: 12, color: RED, w: 0.02, ch: L.brake, sx: 1 });
  P.push({ face: 'rear', dot: [0.55 * k, G.reverse], r: 0.04, color: WHITE, ch: L.reverse, sx: 1 });
  P.push({ face: 'rear', dot: [0.55 * k, G.reverse], r: 0.04, color: WHITE, ch: L.reverse, sx: -1 });
  P.push({ face: 'rear', dot: [0, G.rearFog], r: 0.035, color: RED, ch: L.rearFog, sx: 1 });
  P.push({ face: 'rear', strip: [-0.2, 0.2], y: G.plate, n: 4, color: WARM, w: 0.012, ch: L.plate, sx: 1 });
  return P;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.85;
    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color(0x040405);
    s.fog = new THREE.Fog(0x040405, 12, 34);
    const pm = new THREE.PMREMGenerator(r);
    s.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.16;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(7.4, 2.3, 8.1);
    const c = (this.controls = new OrbitControls(this.camera, canvas));
    c.target.set(-1.1, 0.75, 0); this.wide = true; c.enableDamping = true; c.dampingFactor = 0.06; c.enablePan = false;
    c.minDistance = 5.5; c.maxDistance = 16; c.maxPolarAngle = Math.PI * 0.48; c.minPolarAngle = Math.PI * 0.2;
    c.autoRotate = true; c.autoRotateSpeed = 0.35;
    c.addEventListener('start', () => (c.autoRotate = false));
    // moonlight rim + a soft key so the clay reads at night
    const moon = new THREE.DirectionalLight(0x9fb4ff, 0.35); moon.position.set(-6, 8, -4); s.add(moon);
    const key = new THREE.DirectionalLight(0xffffff, 0.12); key.position.set(5, 6, 6); s.add(key);
    // floor: dark wet asphalt
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.42, metalness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; s.add(floor);
    this.pools = [];
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(s, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.75, 0.5, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.emu = null; this.frame = 0; this.model = 'modely';
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole car in frame on narrow screens
    this.camera.fov = w / h < 0.9 ? 40 : 32;
    // desktop: shift the car right of the headline; phones: centre it
    this.controls?.target.set(w > 900 ? -1.1 : 0, 0.75, 0);
    this.camera.updateProjectionMatrix();
  }

  async loadGltf(url) {
    this.gltfs ||= {};
    if (!this.gltfs[url]) {
      const l = new GLTFLoader(); const d = new DRACOLoader(); d.setDecoderPath('/draco/'); l.setDRACOLoader(d);
      this.gltfs[url] = l.loadAsync(url).then((g) => {
        g.scene.traverse((o) => { if (o.isMesh) { o.material.roughness = 0.62; o.material.envMapIntensity = 1; this.wrapPatch(o.material); } });
        return g.scene;
      });
    }
    return this.gltfs[url];
  }

  // wraps: project the art onto the painted body (light parts of the clay texture), triplanar in object space
  wrapPatch(mat) {
    this.wrapU ||= { wrapMap: { value: null }, wrapOn: { value: 0 } };
    const U = this.wrapU;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.wrapMap = U.wrapMap; sh.uniforms.wrapOn = U.wrapOn;
      sh.vertexShader = 'varying vec3 vOPos; varying vec3 vONorm;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position; vONorm = normal;');
      sh.fragmentShader = 'uniform sampler2D wrapMap; uniform float wrapOn; varying vec3 vOPos; varying vec3 vONorm;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        if (wrapOn > 0.0) {
          vec3 bw = pow(abs(normalize(vONorm)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          vec3 q = vOPos * 0.3;
          vec3 wc = texture2D(wrapMap, q.zy).rgb * bw.x + texture2D(wrapMap, q.xz).rgb * bw.y + texture2D(wrapMap, q.xy).rgb * bw.z;
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float paint = smoothstep(0.45, 0.66, lum);
          diffuseColor.rgb = mix(diffuseColor.rgb, wc * (0.7 + 0.9 * lum), paint * wrapOn);
        }`);
    };
    mat.customProgramCacheKey = () => 'wrap1';
    mat.needsUpdate = true;
  }

  async setWrap(url) {
    this.wrapU ||= { wrapMap: { value: null }, wrapOn: { value: 0 } };
    this.wantWrap = url;
    if (!url) { this.wrapU.wrapOn.value = 0; return; }
    this.wrapTex ||= {};
    if (!this.wrapTex[url]) {
      this.wrapTex[url] = new THREE.TextureLoader().loadAsync(url).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.anisotropy = 4; return t;
      });
    }
    const tex = await this.wrapTex[url];
    if (this.wantWrap !== url) return; // a newer pick already happened
    this.wrapU.wrapMap.value = tex;
    this.wrapU.wrapOn.value = 1;
  }

  /** kind: 'crossover' | 'roadster'. Everything that belongs to the car lives in this.rig, so liftoff moves it all. */
  async setCar(kind = 'crossover') {
    const G = CAR_GEOM[kind] || CAR_GEOM.crossover;
    this.want = kind; // the latest request wins: a slower load that finishes after a newer click is dropped
    if (this.kind === kind && this.rig) return;
    const car = await this.loadGltf(G.url);
    if (this.want !== kind) return;
    if (this.rig) { this.rig.remove(this.car); this.scene.remove(this.rig); }
    this.kind = kind; this.G = G;
    this.rig = new THREE.Group(); this.scene.add(this.rig);
    this.car = car; this.rig.add(car);
    this.rig.updateMatrixWorld(true);
    // frame bigger cars from further away
    const len = new THREE.Box3().setFromObject(car).getSize(new THREE.Vector3()).z;
    const d = this.camera.position.clone().sub(this.controls.target);
    d.setLength(11.1 * Math.max(1, len / 4.75)); this.camera.position.copy(this.controls.target).add(d);
    this.controls.maxDistance = 16 * Math.max(1, len / 4.75);
    this.build();
  }
  async load(url) { await this.setCar('crossover'); } // compat
  /** warm every body + wrap in the background so switching is instant */
  preload(wrapUrls = []) {
    for (const g of Object.values(CAR_GEOM)) this.loadGltf(g.url).catch(() => {});
    this.wrapTex ||= {};
    for (const u of wrapUrls) this.wrapTex[u] ||= new THREE.TextureLoader().loadAsync(u).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.anisotropy = 4; return t; });
  }

  // cast a ray at the body to put each lamp on the surface
  hit(face, a, b) {
    const ray = new THREE.Raycaster();
    let o, dir;
    if (face === 'front') { o = new THREE.Vector3(a, b, 6); dir = new THREE.Vector3(0, 0, -1); }
    else if (face === 'rear') { o = new THREE.Vector3(a, b, -6); dir = new THREE.Vector3(0, 0, 1); }
    else { o = new THREE.Vector3(Math.sign(a) * 4, b, 0); dir = new THREE.Vector3(-Math.sign(a), 0, 0); }
    ray.set(o, dir);
    const h = ray.intersectObject(this.car, true)[0];
    if (!h) return null;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    return { p: h.point.clone().addScaledVector(dir, -0.012), n };
  }

  build() {
    const G = this.G, rig = this.rig;
    this.flames = null;
    const lamps = (this.lamps = []);
    const segGeo = new THREE.BoxGeometry(1, 1, 1);
    const dotGeo = new THREE.SphereGeometry(1, 16, 12);
    for (const d of layout(G)) {
      const pts = [];
      if (d.strip) {
        for (let i = 0; i < d.n; i++) {
          const x = (d.strip[0] + ((d.strip[1] - d.strip[0]) * (i + 0.5)) / d.n) * d.sx;
          const h = this.hit(d.face, x, d.y); if (h) pts.push(h);
        }
      } else if (d.dot) { const h = this.hit(d.face, d.dot[0] * d.sx, d.dot[1]); if (h) pts.push(h); }
      else if (d.side) {
        const ray = new THREE.Raycaster(new THREE.Vector3(4 * d.sx, d.side[1], d.side[0]), new THREE.Vector3(-d.sx, 0, 0));
        const h = ray.intersectObject(this.car, true)[0];
        if (h) pts.push({ p: h.point.clone().add(new THREE.Vector3(0.012 * d.sx, 0, 0)), n: new THREE.Vector3(d.sx, 0, 0) });
      }
      if (!pts.length) continue;
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      const mesh = new THREE.InstancedMesh(d.strip ? segGeo : dotGeo, mat, pts.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      const segLen = d.strip ? (Math.abs(d.strip[1] - d.strip[0]) / d.n) * 1.08 : 0;
      pts.forEach((h, i) => {
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.n.lengthSq() ? h.n : new THREE.Vector3(0, 0, 1));
        const sc = d.strip ? (d.vertical ? new THREE.Vector3(segLen * 0.6, d.w, 0.01) : new THREE.Vector3(segLen, d.w, 0.01)) : new THREE.Vector3(d.r, d.r, d.r * 0.4);
        m4.compose(h.p, q, sc); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, new THREE.Color(0));
      });
      rig.add(mesh);
      lamps.push({ ...d, mesh, count: pts.length, pts });
    }
    // headlight beams
    this.beams = [];
    const beamMat = () => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { u: { value: 0 }, col: { value: WHITE.clone() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float u; uniform vec3 col; varying vec2 vUv; void main(){ float a = pow(vUv.y, 3.0) * u * 0.045; gl_FragColor = vec4(col*a, a); }',
    });
    for (const sx of [1, -1]) {
      const h = this.hit('front', 0.73 * G.halfW * sx, G.head); if (!h) continue;
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1.25, 7, 32, 1, true), beamMat());
      cone.geometry.translate(0, -3.5, 0); cone.geometry.rotateX(-Math.PI / 2 + 0.09); // forward, slightly down
      cone.position.copy(h.p); cone.position.z += 0.02;
      rig.add(cone);
      const spot = new THREE.SpotLight(0xeaf2ff, 0, 22, 0.42, 0.6, 1.2);
      spot.position.copy(h.p); spot.target.position.set(h.p.x * 1.4, 0, h.p.z + 7); rig.add(spot, spot.target);
      this.beams.push({ cone, spot, side: sx });
    }
    this.rearLight = new THREE.PointLight(0xff1414, 0, 7, 1.6); this.rearLight.position.set(0, G.tail - 0.1, -2.9); rig.add(this.rearLight);
    this.cabin = new THREE.PointLight(0xffffff, 0, 1.0, 1.2); this.cabin.position.set(0, G.cabin[0], G.cabin[1]); rig.add(this.cabin);
    this.cabin2 = new THREE.PointLight(0xffffff, 0, 1.0, 1.2); this.cabin2.position.set(0, G.cabin[2], G.cabin[3]); rig.add(this.cabin2);
    // charge port
    const cpRay = new THREE.Raycaster(new THREE.Vector3(4, G.port[1], G.port[0]), new THREE.Vector3(-1, 0, 0)).intersectObject(this.car, true)[0];
    this.port = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0, toneMapped: false }));
    if (cpRay) this.port.position.copy(cpRay.point).add(new THREE.Vector3(0.01, 0, 0));
    this.port.visible = !!cpRay;
    rig.add(this.port);
    if (G.thrusters) this.buildThrusters(G);
  }

  // SpaceX-style cold-gas thrusters under the car + the dust they kick up
  buildThrusters(G) {
    const flameMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { u: { value: 0 }, t: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float u; uniform float t; varying vec2 vUv;
        void main(){ float n = 0.85 + 0.15*sin(t*47.0 + vUv.x*6.2832);
          float core = pow(vUv.y, 2.4);
          float a = core * u * n * 0.9;
          vec3 c = mix(vec3(0.35,0.6,1.0), vec3(1.0), pow(vUv.y, 6.0)) * 1.6;
          gl_FragColor = vec4(c*a, a); }`,
    });
    this.flames = [];
    for (const [x, z] of G.thrusters) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.2, 1, 24, 1, true), flameMat);
      f.geometry.translate(0, -0.5, 0); // hangs down from the nozzle
      f.position.set(x, G.belly, z); this.rig.add(f); this.flames.push(f);
    }
    this.flameMat = flameMat;
    this.under = new THREE.PointLight(0xbfd8ff, 0, 6, 1.5); this.under.position.set(0, G.belly - 0.2, 0); this.rig.add(this.under);
    if (!this.dust) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.55, 'rgba(200,215,240,0.55)'); grd.addColorStop(1, 'rgba(200,215,240,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      this.dust = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0 }));
      this.dust.rotation.x = -Math.PI / 2; this.dust.position.y = 0.01; this.scene.add(this.dust);
    }
  }

  /** liftoff = { start, end } in seconds, or null */
  setLiftoff(w) { this.liftoff = w; }

  flight(t) {
    const w = this.liftoff;
    if (!w || !this.flames) return { h: 0, thrust: 0 };
    const ign = w.start - 1.2, up = 2.2, down = 2.4, H = 1.5;
    const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    let h = 0, thrust = 0;
    if (t >= ign && t < w.end + 1.5) {
      thrust = Math.min(1, (t - ign) / 1.2);
      if (t > w.end) thrust = Math.max(0, 1 - (t - w.end) / 1.5);
      h = H * ease((t - w.start) / up) * (1 - ease((t - (w.end - down)) / down));
      h += Math.sin(t * 2.3) * 0.05 * Math.min(1, h / H); // hover bob
    }
    return { h, thrust };
  }

  setShow(emu, model) { this.emu = emu; this.model = model || 'modely'; }

  /** t in seconds (audio time) */
  render(t) {
    this.controls.update();
    if (this.rig) {
      const { h, thrust } = this.flight(t);
      this.rig.position.y = h;
      this.rig.rotation.z = Math.sin(t * 1.7) * 0.012 * (h > 0.05 ? 1 : 0);
      if (this.flames) {
        this.flameMat.uniforms.u.value = thrust; this.flameMat.uniforms.t.value = t;
        for (const f of this.flames) { f.visible = thrust > 0.01; f.scale.set(1, Math.max(0.05, (this.G.belly + h) * (0.45 + 0.55 * thrust)), 1); }
        this.under.intensity = thrust * 9;
        const r = 2 + thrust * 2.2 + h * 1.4;
        this.dust.scale.set(r * 1.5, r * 2, 1); this.dust.material.opacity = thrust * Math.max(0.05, 0.2 - h * 0.08);
      } else if (this.dust) this.dust.material.opacity = 0;
    }
    const e = this.emu;
    if (e && this.lamps) {
      const f = Math.max(0, Math.min(e.frameCount - 1, Math.floor(t * 50)));
      const ct = this.model === 'cybertruck';
      const tmp = new THREE.Color();
      for (const lp of this.lamps) {
        let any = 0;
        for (let i = 0; i < lp.count; i++) {
          let v = e.light(f, lp.ch);
          if (ct && lp.bar) { // Cybertruck light bars: one LED per segment
            const k = lp.sx > 0 ? i : i; // left half uses the left bar, right half the right bar
            const b = lp.bar === 'front' ? (lp.sx > 0 ? BAR.frontLeft : BAR.frontRight) : (lp.sx > 0 ? BAR.rearLeft : BAR.rearRight);
            const idx = lp.sx > 0 ? b.n - 1 - Math.floor((k * b.n) / lp.count) : Math.floor((k * b.n) / lp.count);
            v = Math.max(v * 0.2, e.raw(f, b.start + idx) / 255);
          }
          any = Math.max(any, v);
          tmp.copy(lp.color).multiplyScalar(v * (lp.beam ? 9 : 5));
          lp.mesh.setColorAt(i, tmp);
        }
        lp.mesh.visible = any > 0.01; // an unlit lamp just disappears into the body
        lp.mesh.instanceColor.needsUpdate = true;
      }
      for (const b of this.beams) {
        const chs = b.side > 0 ? [L.outer[0], L.inner[0]] : [L.outer[1], L.inner[1]];
        const v = Math.max(e.light(f, chs[0]), e.light(f, chs[1]) * 0.8);
        b.cone.material.uniforms.u.value = v;
        b.spot.intensity = v * 12;
      }
      const red = Math.max(e.light(f, L.tail[0]), e.light(f, L.tail[1]), e.light(f, L.brake) * 1.3);
      this.rearLight.intensity = red * 6;
      const [R, G, B] = e.rgb(f, RGB.display);
      const lvl = Math.max(R, G, B) / 255;
      this.cabin.color.setRGB(R / 255, G / 255, B / 255).multiplyScalar(lvl > 0 ? 1 / lvl : 0);
      const ck = this.kind === 'roadster' ? 0.45 : 1; // open top: the cabin glow shows a lot more
      this.cabin.intensity = lvl * 4 * ck; this.cabin2.color.copy(this.cabin.color); this.cabin2.intensity = lvl * 3 * ck;
      const cp = e.closures.chargePort[0];
      if (cp.dance[f]) this.port.material.color.setHSL((t * 1.6) % 1, 1, 0.55).multiplyScalar(4);
      else this.port.material.color.setRGB(0, cp.pos[f] > 0.5 ? 0.4 : 0, cp.pos[f] > 0.5 ? 1.2 : 0);
    }
    this.composer.render();
  }
}
