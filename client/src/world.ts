import * as THREE from 'three';
import type { CrateId } from './state';
import { INNER_RADIUS_M, shellThicknessM } from './science';
import { asset } from './assets';

export interface Circle {
  x: number;
  z: number;
  r: number;
}
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const POS = {
  start: { x: 0, z: 8 },
  workshopDoor: { x: -8, z: 7.6 },
  pedestal: { x: 8, z: 0 },
  mica: { x: 4.6, z: 0.8 },
  console: { x: 8, z: 3.4 },
} as const;

export const WORLD_HALF = 28;

// ---------------------------------------------------------------- địa hình
function hash2(i: number, j: number) {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, oct: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, z * f);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum; // ~[0,1)
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Khu chơi được san phẳng (độ cao 0) để model đặt đúng chỗ: [x, z, bán kính phẳng, bán kính chuyển tiếp]
const FLAT: [number, number, number, number][] = [
  [0, 8, 5, 11], // điểm xuất phát
  [-8, 4.5, 7, 13], // xưởng
  [7, 1.5, 7.5, 14], // bệ, MICA, màn hình
  [-16, 13, 6, 12], // tàu đổ bộ
  [-6, -14, 5.5, 11], // kiện bộ ghi
  [18, 14, 5.5, 11], // kiện phantom
  [-20, -4, 5.5, 11], // kiện phụ
];

interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}
const CRATERS: Crater[] = (() => {
  const r = rng(555);
  const list: Crater[] = [];
  for (let i = 0; i < 14; i++) {
    list.push({ x: (r() - 0.5) * 60, z: (r() - 0.5) * 60, r: 6 + r() * 8, depth: 0.7 + r() * 1.0 });
  }
  return list;
})();

// Hố trẻ, nhỏ, sâu và gờ sắc (độ sâu ≈ 1/5 đường kính, đặc trưng hố va chạm mới).
const FRESH: Crater[] = (() => {
  const r = rng(808);
  const list: Crater[] = [];
  for (let i = 0; i < 16; i++) {
    const rad = 1.6 + r() * 2.6;
    list.push({ x: (r() - 0.5) * 56, z: (r() - 0.5) * 56, r: rad, depth: rad * 2 * 0.2 });
  }
  return list;
})();

/** Độ cao mặt đất tại (x, z) theo mét. */
export function heightAt(x: number, z: number): number {
  // đồi lăn + gồ nhỏ
  let h = (fbm(x * 0.035 + 11, z * 0.035 - 7, 4) - 0.5) * 6.6 + (fbm(x * 0.25, z * 0.25, 2) - 0.5) * 0.35;
  // miệng hố: lòng chảo + gờ cao
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r * 1.8) {
      const t = d / c.r;
      if (t < 1) h -= c.depth * (1 - t * t) * (1 - t * t * 0.2);
      h += c.depth * 0.32 * Math.exp(-(((t - 1.02) / 0.28) ** 2));
    }
  }
  for (const c of FRESH) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r * 1.7) {
      const t = d / c.r;
      if (t < 1) h -= c.depth * (1 - t * t);
      h += c.depth * 0.2 * Math.exp(-(((t - 1.0) / 0.22) ** 2));
    }
  }
  // san phẳng quanh khu chơi
  let keep = 1;
  for (const [fx, fz, r0, r1] of FLAT) {
    keep = Math.min(keep, smooth(r0, r1, Math.hypot(x - fx, z - fz)));
  }
  h *= keep;
  // vành núi bao quanh chân trời
  const e = Math.max(Math.abs(x), Math.abs(z)) - (WORLD_HALF + 1);
  if (e > 0) h += (10 + fbm(x * 0.06, z * 0.06, 3) * 9) * smooth(0, 30, e);
  return h;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const mat = (color: number, rough = 0.9, metal = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export interface World {
  circles: Circle[];
  boxes: Box[];
  dir: THREE.DirectionalLight;
}

export function buildWorld(scene: THREE.Scene): World {
  scene.background = new THREE.Color(0x05060b);
  scene.fog = new THREE.Fog(0x020307, 85, 135);

  scene.add(new THREE.HemisphereLight(0x3a4a6c, 0x16161a, 0.62));
  const dir = new THREE.DirectionalLight(0xfff4e0, 4.2);
  dir.position.set(-40, 13, 12);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1536, 1536);
  const sc = dir.shadow.camera;
  sc.left = -36;
  sc.right = 36;
  sc.top = 36;
  sc.bottom = -36;
  sc.far = 90;
  dir.shadow.bias = -0.0004;
  scene.add(dir);
  const earthshine = new THREE.DirectionalLight(0x6f94d6, 0.38);
  earthshine.position.set(40, 22, -30);
  scene.add(earthshine);

  // Mặt đất
  const gtex = makeGroundTexture();
  const geo = new THREE.PlaneGeometry(130, 130, 190, 190);
  geo.rotateX(-Math.PI / 2);
  const gp = geo.attributes.position;
  const cols = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i);
    const z = gp.getZ(i);
    const h = heightAt(x, z);
    gp.setY(i, h);
    // lòng hố tối hơn, đỉnh/gờ sáng hơn một chút
    const shade = 0.84 + Math.max(-0.16, Math.min(0.16, h * 0.06));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: gtex, bumpMap: makeDetailTexture(), bumpScale: 1.6, roughness: 1, vertexColors: true }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // Sao
  const starPts: number[] = [];
  const rs = rng(99);
  for (let i = 0; i < 700; i++) {
    const a = rs() * Math.PI * 2;
    const e = rs() * 1.2 + 0.1;
    const d = 160;
    starPts.push(Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d, Math.sin(a) * Math.cos(e) * d);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, fog: false })));

  // Trái Đất
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(9, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x3b7cc4, emissive: 0x0c2a55, roughness: 0.8, fog: false }),
  );
  earth.position.set(-70, 60, -110);
  scene.add(earth);

  const circles: Circle[] = [];
  const boxes: Box[] = [];

  // Xưởng
  const ws = new THREE.Group();
  const wsBody = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 5), mat(0xd7dadf, 0.5, 0.2));
  wsBody.position.y = 1.5;
  wsBody.castShadow = true;
  wsBody.receiveShadow = true;
  const wsDoor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.1), mat(0x2f6fb3, 0.4));
  wsDoor.position.set(0, 1.1, 2.55);
  const wsLight = new THREE.Mesh(
    new THREE.BoxGeometry(5, 0.12, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x7fe3c0 }),
  );
  wsLight.position.set(0, 2.7, 2.52);
  ws.add(wsBody, wsDoor, wsLight);
  ws.position.set(-8, 0, 4);
  scene.add(ws);
  const wsA = asset('workshop');
  if (wsA) {
    scene.remove(ws);
    wsA.position.set(-8, 0, 4);
    scene.add(wsA);
  }
  boxes.push({ minX: -11, maxX: -5, minZ: 1.5, maxZ: 6.5 });

  // Tàu đổ bộ (trang trí)
  const lander = new THREE.Group();
  const lBody = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 3.4, 10), mat(0xc9a64b, 0.35, 0.6));
  lBody.position.y = 3.2;
  lBody.castShadow = true;
  lander.add(lBody);
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.6, 6), mat(0x888888, 0.4, 0.7));
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    leg.position.set(Math.cos(a) * 3, 1.5, Math.sin(a) * 3);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    lander.add(leg);
  }
  lander.position.set(-16, 0, 13);
  scene.add(lander);
  const lanA = asset('lander');
  if (lanA) {
    scene.remove(lander);
    lanA.position.set(-16, 0, 13);
    lanA.rotation.y = 0.6;
    scene.add(lanA);
  }
  circles.push({ x: -16, z: 13, r: 3.2 });

  // Bệ nghiên cứu
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 24), mat(0x3d4650, 0.4, 0.5));
  pedestal.position.set(POS.pedestal.x, 0.175, POS.pedestal.z);
  pedestal.receiveShadow = true;
  scene.add(pedestal);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.04, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xffb454 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(POS.pedestal.x, 0.36, POS.pedestal.z);
  scene.add(ring);
  const pedA = asset('pedestal');
  if (pedA) {
    scene.remove(pedestal, ring);
    pedA.position.set(POS.pedestal.x, 0, POS.pedestal.z);
    scene.add(pedA);
  }

  // Màn hình bệ
  const con = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), mat(0x333a44, 0.5, 0.5));
  stand.position.y = 0.45;
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.8, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x0b1d1a, emissive: 0x2dd4a8, emissiveIntensity: 0.9 }),
  );
  screen.position.set(0, 1.15, 0);
  screen.rotation.x = -0.25;
  con.add(stand, screen);
  con.position.set(POS.console.x, 0, POS.console.z);
  con.traverse((o) => (o.castShadow = true));
  scene.add(con);
  const conA = asset('console');
  if (conA) {
    scene.remove(con);
    conA.position.set(POS.console.x, 0, POS.console.z);
    scene.add(conA);
  }
  circles.push({ x: POS.pedestal.x, z: POS.pedestal.z, r: 1.3 });
  circles.push({ x: POS.console.x, z: POS.console.z, r: 0.5 });

  // Đá: cụm chắn quanh kiện + rải ngẫu nhiên
  const keep = [
    POS.start,
    POS.workshopDoor,
    POS.pedestal,
    POS.mica,
    POS.console,
    { x: -6, z: -14 },
    { x: 18, z: 14 },
    { x: -20, z: -4 },
  ];
  const rr = rng(2024);
  const rockMat = mat(0x6e6c68, 1);
  // Đá tảng dùng InstancedMesh: 4 kiểu đá = 4 lệnh vẽ thay vì mỗi tảng một lệnh.
  const rockSrc = [0, 1, 2, 3].map((i) => asset(`rock${i}`)?.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined);
  const rockMats: THREE.Matrix4[][] = [[], [], [], []];
  const addRock = (x: number, z: number, s: number) => {
    const vi = Math.floor(rr() * 4);
    if (rockSrc[vi]) {
      rockMats[vi].push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, heightAt(x, z) - 0.02, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rr() * Math.PI * 2, 0)),
          new THREE.Vector3(s * (0.9 + rr() * 0.3), s * (0.8 + rr() * 0.5), s * (0.9 + rr() * 0.3)),
        ),
      );
      circles.push({ x, z, r: s * 0.95 });
      return;
    }
    const g = new THREE.DodecahedronGeometry(s, 0);
    const m = new THREE.Mesh(g, rockMat);
    m.position.set(x, heightAt(x, z) + s * 0.55, z);
    m.rotation.set(rr() * 3, rr() * 3, rr() * 3);
    m.scale.y = 0.75;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    circles.push({ x, z, r: s * 0.9 });
  };
  const far = (x: number, z: number, min: number) =>
    keep.every((k) => Math.hypot(k.x - x, k.z - z) > min);
  // cụm quanh kiện bộ ghi (cần đi vòng)
  for (const [dx, dz, s] of [[2.2, 1.6, 1.3], [-2.4, 1.2, 1.1], [0, 3.1, 1.5], [2.8, -1.8, 1.0]] as const) {
    addRock(-6 + dx, -14 + dz, s);
  }
  for (const [dx, dz, s] of [[-2.2, -1.6, 1.2], [2.2, -2, 1.4], [-3, 1.2, 1.0]] as const) {
    addRock(18 + dx, 14 + dz, s);
  }
  for (let i = 0; i < 38; i++) {
    const x = (rr() - 0.5) * 2 * (WORLD_HALF - 2);
    const z = (rr() - 0.5) * 2 * (WORLD_HALF - 2);
    if (!far(x, z, 4.5)) continue;
    if (boxes.some((b) => x > b.minX - 2 && x < b.maxX + 2 && z > b.minZ - 2 && z < b.maxZ + 2)) continue;
    addRock(x, z, 0.4 + rr() * 1.1);
  }
  rockSrc.forEach((src, i) => {
    const list = rockMats[i];
    if (!src || !list.length) return;
    const im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
  });

  // Sỏi vụn khắp nơi (InstancedMesh) và đá tảng quanh hố trẻ: mô phỏng đá văng ra từ va chạm.
  {
    const N = 1400;
    const inst = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x66625b, roughness: 1, flatShading: true }),
      N,
    );
    inst.castShadow = false;
    inst.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const rp = rng(4242);
    for (let i = 0; i < N; i++) {
      let x = (rp() - 0.5) * 2 * (WORLD_HALF + 2);
      let z = (rp() - 0.5) * 2 * (WORLD_HALF + 2);
      if (rp() < 0.4) {
        // tụ quanh hố trẻ
        const c = FRESH[Math.floor(rp() * FRESH.length)];
        const a = rp() * Math.PI * 2;
        const d = c.r * (1.1 + rp() * 2.2);
        x = c.x + Math.cos(a) * d;
        z = c.z + Math.sin(a) * d;
      }
      const sc = 0.03 + Math.pow(rp(), 2.5) * 0.3;
      e.set(rp() * 3, rp() * 6, rp() * 3);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, heightAt(x, z) - sc * 0.15, z), q, new THREE.Vector3(sc, sc * (0.6 + rp() * 0.5), sc));
      inst.setMatrixAt(i, m);
    }
    scene.add(inst);
  }
  for (const c of FRESH) {
    const n = 2 + Math.floor(rr() * 3);
    for (let i = 0; i < n; i++) {
      const a = rr() * Math.PI * 2;
      const d = c.r * (1.15 + rr() * 0.9);
      const bx = c.x + Math.cos(a) * d;
      const bz = c.z + Math.sin(a) * d;
      if (Math.abs(bx) < WORLD_HALF && Math.abs(bz) < WORLD_HALF && far(bx, bz, 6)) addRock(bx, bz, 0.35 + rr() * 0.55);
    }
  }

  return { circles, boxes, dir };
}

const CRATE_COLOR: Record<CrateId, number> = { logger: 0x3b82f6, phantom: 0xf59e0b, bonus: 0x34d399 };

export function makeCrate(id: CrateId): THREE.Group {
  const a = asset(`crate_${id}`);
  if (a) {
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 4),
      new THREE.MeshBasicMaterial({ color: CRATE_COLOR[id] }),
    );
    marker.rotation.x = Math.PI;
    marker.position.y = 1.8;
    marker.name = 'marker';
    a.add(marker);
    return a;
  }
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), mat(0xb9bec6, 0.5, 0.4));
  box.position.y = 0.4;
  box.castShadow = true;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 0.18, 1.02),
    new THREE.MeshStandardMaterial({ color: CRATE_COLOR[id], emissive: CRATE_COLOR[id], emissiveIntensity: 0.6 }),
  );
  stripe.position.y = 0.55;
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.5, 4),
    new THREE.MeshBasicMaterial({ color: CRATE_COLOR[id] }),
  );
  marker.rotation.x = Math.PI;
  marker.position.y = 1.8;
  marker.name = 'marker';
  g.add(box, stripe, marker);
  return g;
}

export function makePlayer(): THREE.Group {
  const a = asset('astronaut');
  if (a) return a;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.75, 6, 12), mat(0xf1f1ee, 0.6));
  body.position.y = 0.85;
  body.castShadow = true;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mat(0xf6f6f4, 0.4));
  helmet.position.y = 1.62;
  helmet.castShadow = true;
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.9, roughness: 0.15 }),
  );
  visor.position.set(0, 1.62, 0.1);
  visor.rotation.x = Math.PI / 2.4;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), mat(0xcfd3d8, 0.6));
  pack.position.set(0, 1.0, -0.34);
  g.add(body, helmet, visor, pack);
  return g;
}

export function makeMica(): THREE.Group {
  const a = asset('mica');
  if (a) return a;
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.3, 16), mat(0x39424d, 0.4, 0.6));
  base.position.y = 0.15;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 6, 12), mat(0xe8ecef, 0.35, 0.3));
  torso.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), mat(0xf2f4f6, 0.3, 0.2));
  head.position.y = 1.55;
  head.name = 'head';
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x4ee6c0 }),
  );
  eye.position.set(0, 1.58, 0.26);
  eye.name = 'eye';
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.5, 4, 8), mat(0x39424d, 0.4, 0.6));
  armL.position.set(-0.42, 0.9, 0);
  armL.name = 'armL';
  const armR = armL.clone();
  armR.position.x = 0.42;
  armR.name = 'armR';
  g.add(base, torso, head, eye, armL, armR);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function makePhantom(): THREE.Group {
  const a = asset('phantom');
  if (a) {
    a.position.set(POS.pedestal.x, 0.35, POS.pedestal.z);
    return a;
  }
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xe8b99a, roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 6, 10), m);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), m);
  head.position.y = 1.8;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 6, 10), m);
  legs.position.y = 0.55;
  g.add(torso, head, legs);
  g.traverse((o) => (o.castShadow = true));
  g.position.set(POS.pedestal.x, 0.35, POS.pedestal.z);
  return g;
}

let domeTex: THREE.CanvasTexture | null = null;
function domeTexture(): THREE.CanvasTexture {
  if (!domeTex) {
    domeTex = makeGroundTexture();
    domeTex.repeat.set(8, 2);
  }
  return domeTex;
}

export const DOME_CLIP = new THREE.Plane(new THREE.Vector3(-1, 0, 0), POS.pedestal.x);

/** Vỏ bán cầu. Độ dày hiển thị được phóng đại để dễ nhìn, khối lượng vẫn tính theo công thức thật. */
export function makeDome(arealDensity: number, ghost = false): THREE.Mesh {
  const t = shellThicknessM(arealDensity);
  const rIn = INNER_RADIUS_M + 0.25;
  const rOut = rIn + 0.12 + t * 4;
  const pts: THREE.Vector2[] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(rIn * Math.sin(a), rIn * Math.cos(a)));
  }
  for (let i = N; i >= 0; i--) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(rOut * Math.sin(a), rOut * Math.cos(a)));
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  const material = new THREE.MeshStandardMaterial({
    color: ghost ? 0x58d6ff : 0xffffff,
    map: ghost ? null : domeTexture(),
    bumpMap: ghost ? null : domeTexture(),
    bumpScale: 1.5,
    roughness: 1,
    side: THREE.DoubleSide,
    transparent: ghost,
    opacity: ghost ? 0.35 : 1,
    wireframe: ghost,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(POS.pedestal.x, 0.35, POS.pedestal.z);
  mesh.castShadow = !ghost;
  mesh.receiveShadow = !ghost;
  return mesh;
}

/** Texture regolith tạo bằng canvas: hạt nhiễu + miệng hố nhỏ. 2048px để không bị phóng to khi nhìn gần. */
export function makeGroundTexture(): THREE.CanvasTexture {
  const N = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const r = rng(31337);
  g.fillStyle = '#6c6963';
  g.fillRect(0, 0, N, N);
  // vùng sáng/tối lớn để phá lặp texture
  for (let i = 0; i < 90; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = 80 + r() * 260;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    grad.addColorStop(0, dark ? 'rgba(40,38,36,0.10)' : 'rgba(150,146,138,0.08)');
    grad.addColorStop(1, 'rgba(108,105,99,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // hạt mịn dày đặc
  for (let i = 0; i < 260000; i++) {
    const v = 56 + Math.floor(r() * 84);
    g.fillStyle = `rgba(${v},${v - 2},${v - 6},${0.14 + r() * 0.3})`;
    const sz = 1 + r() * 2.2;
    g.fillRect(r() * N, r() * N, sz, sz);
  }
  // miệng hố nhỏ mềm
  for (let i = 0; i < 40; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = 50 + r() * 190;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const grad = g.createRadialGradient(x + ox, y + oy, rad * 0.1, x + ox, y + oy, rad);
      grad.addColorStop(0, 'rgba(66,64,62,0.24)');
      grad.addColorStop(0.65, 'rgba(88,86,82,0.12)');
      grad.addColorStop(0.9, 'rgba(150,146,138,0.14)');
      grad.addColorStop(1, 'rgba(108,105,99,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** Bump mịn lặp dày: tạo cảm giác bề mặt hạt khi nhìn gần, không bị nhòe. */
function makeDetailTexture(): THREE.CanvasTexture {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const r = rng(777);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 40000; i++) {
    const v = 70 + Math.floor(r() * 120);
    g.fillStyle = `rgb(${v},${v},${v})`;
    const sz = 1 + r() * 2.4;
    g.fillRect(r() * N, r() * N, sz, sz);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(55, 55);
  t.anisotropy = 16;
  return t;
}
