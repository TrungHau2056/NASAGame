import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NAMES = [
  'astronaut',
  'mica',
  'workshop',
  'lander',
  'crate_logger',
  'crate_phantom',
  'crate_bonus',
  'pedestal',
  'console',
  'phantom',
  'rock0',
  'rock1',
  'rock2',
  'rock3',
] as const;

const store = new Map<string, THREE.Group>();

// Model không cần hoạt ảnh theo từng bộ phận: gộp mọi mảnh cùng vật liệu thành một mesh để giảm lệnh vẽ.
const STATIC = new Set(['workshop', 'lander', 'crate_logger', 'crate_phantom', 'crate_bonus', 'pedestal', 'console']);

function mergeStatic(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const list = byMat.get(mat) ?? [];
    list.push(g);
    byMat.set(mat, list);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (merged) out.add(new THREE.Mesh(merged, mat));
  }
  return out;
}

/** Tải toàn bộ GLB dựng từ Blender. Thiếu file nào thì game dùng hình khối dự phòng. */
export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(
    NAMES.map(async (n) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${n}.glb`);
        store.set(n, STATIC.has(n) ? mergeStatic(gltf.scene) : gltf.scene);
      } catch (e) {
        console.warn(`Không tải được model ${n}, dùng hình khối dự phòng.`, e);
      } finally {
        onProgress?.(++done, NAMES.length);
      }
    }),
  );
}

/** Bản sao của model (chia sẻ geometry và material), hoặc null nếu chưa có. */
export function asset(name: string): THREE.Group | null {
  const src = store.get(name);
  if (!src) return null;
  const c = src.clone(true);
  c.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return c;
}
