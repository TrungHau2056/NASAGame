import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { describeLevel, planDesign, type Plan } from './mica';
import {
  HANDOVER,
  LEVELS,
  accumulatedMicroSv,
  findLevel,
  meetsHandover,
  shellMassKg,
  validateConfig,
} from './science';
import { CRATE_LABEL, saveState, type Crate, type State } from './state';
import {
  DOME_CLIP,
  POS,
  WORLD_HALF,
  buildWorld,
  heightAt,
  makeCrate,
  makeDome,
  makeMica,
  makePhantom,
  makePlayer,
} from './world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number, d = 0) => n.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
const BAG_SLOTS = 2;
const BUILD_SECONDS = 6;
const RECORD_GOAL_SEC = 60;

interface Spot {
  kind: 'crate' | 'workshop' | 'pedestal' | 'console' | 'mica';
  x: number;
  z: number;
  range: number;
  crate?: Crate;
}

export function startGame(canvas: HTMLCanvasElement, s: State): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  type Quality = 'auto' | 'high' | 'low';
  let quality: Quality = 'auto';
  try {
    const q = localStorage.getItem('hd.quality');
    if (q === 'high' || q === 'low' || q === 'auto') quality = q;
  } catch {
    // bỏ qua
  }
  const dpr = window.devicePixelRatio || 1;
  const prFor = (q: Quality) => (q === 'high' ? Math.min(dpr, 2) : q === 'low' ? 0.75 : Math.min(dpr, 1.5));
  let maxPR = prFor(quality);
  let minPR = quality === 'low' ? 0.6 : 0.9;
  let curPR = maxPR;
  renderer.setPixelRatio(curPR);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  // Môi trường phản chiếu cho vật liệu kim loại (visor, lớp bọc tàu).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.2;
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const world = buildWorld(scene);

  const player = makePlayer();
  player.position.set(s.player.x, 0, s.player.z);
  scene.add(player);

  const limbs = {
    legL: player.getObjectByName('legL'),
    legR: player.getObjectByName('legR'),
    armL: player.getObjectByName('armL'),
    armR: player.getObjectByName('armR'),
  };

  const mica = makeMica();
  mica.position.set(POS.mica.x, 0, POS.mica.z);
  scene.add(mica);

  const phantom = makePhantom();
  scene.add(phantom);

  const crateMesh = new Map<string, THREE.Group>();
  for (const c of s.crates) {
    const m = makeCrate(c.id);
    crateMesh.set(c.id, m);
    scene.add(m);
  }

  let dome: THREE.Mesh | null = null;
  let ghost: THREE.Mesh | null = null;
  let cutaway = false;
  let buildT = -1; // >= 0 khi đang xây
  let paused = false;
  let uiOpen = false;
  let lastPlan: Plan | null = null;
  const vel = new THREE.Vector3();
  let swingAmp = 0;
  let walk = 0;

  // ---------- Tiện ích trạng thái ----------
  const crate = (id: string) => s.crates.find((c) => c.id === id)!;
  const bag = () => s.crates.filter((c) => c.where === 'bag');
  const hasBag = (id: string) => crate(id).where === 'bag';
  const version = () => (s.currentVersion >= 0 ? s.versions[s.currentVersion] : null);
  const building = () => buildT >= 0;

  const radioLog: { from: string; text: string }[] = [];
  function radio(from: string, text: string) {
    radioLog.push({ from, text });
    if (radioLog.length > 4) radioLog.shift();
    const box = $('radio');
    box.replaceChildren();
    radioLog.forEach((m, i) => {
      const p = document.createElement('p');
      if (i < radioLog.length - 1) p.className = 'old';
      const f = document.createElement('span');
      f.className = 'from';
      f.textContent = `${m.from}: `;
      p.append(f, document.createTextNode(m.text));
      box.append(p);
    });
  }

  function persist() {
    s.player.x = player.position.x;
    s.player.z = player.position.z;
    saveState(s);
  }

  // ---------- Công trình ----------
  function applyCut() {
    if (!dome) return;
    (dome.material as THREE.MeshStandardMaterial).clippingPlanes = cutaway ? [DOME_CLIP] : [];
  }
  function clearGhost() {
    if (ghost) {
      scene.remove(ghost);
      ghost = null;
    }
  }
  function showDome(areal: number, scale: number) {
    if (dome) scene.remove(dome);
    dome = makeDome(areal);
    dome.scale.setScalar(scale);
    scene.add(dome);
    applyCut();
  }

  // ---------- Nhiệm vụ & HUD ----------
  function mission(): 1 | 2 | 3 | 4 {
    if (!s.m1Done) return 1;
    if (!s.m2Done) return 2;
    return s.handedOver ? 4 : 3;
  }
  const placed = (id: string) => crate(id).where === 'placed';

  function objectiveText(): string {
    const v = version();
    switch (mission()) {
      case 1:
        return `Mang bộ ghi dữ liệu (xanh) và mô hình cơ thể (cam) về xưởng. Trong túi: ${bag().length}/${BAG_SLOTS}.`;
      case 2:
        if (!(placed('phantom') && placed('logger'))) return 'Mang bộ ghi và mô hình cơ thể ra bệ nghiên cứu rồi đặt chúng lên bệ.';
        if (!v) return 'Nói chuyện với MICA để thiết kế vòm che chắn quanh mô hình cơ thể.';
        if (building()) return 'MICA đang thi công vòm...';
        if (!s.recording) return 'Vòm đã xong. Mở màn hình bệ và bật ghi dữ liệu.';
        return `Đang ghi dữ liệu: ${Math.floor(v.recordedSec)}/${RECORD_GOAL_SEC} giây. Có thể đi lấy kiện phụ trong lúc chờ.`;
      case 3:
        return `Bàn giao thiết kế đạt GCR ≤ ${fmt(HANDOVER.maxGcr, 2)} mSv/ngày và vỏ ≤ ${fmt(HANDOVER.maxMassKg)} kg. Giữ bản hiện tại hoặc cải tiến cùng MICA.`;
      default:
        return 'Chương hoàn thành. Bạn có thể tiếp tục cải tiến và so sánh phiên bản.';
    }
  }

  let fpv = false;
  let fpYaw = 0;
  let fpPitch = 0;
  let bookT = 0;
  let lastPrompt: string | null = null;
  let lastObj = '';
  let lastBag = '';
  let lastRad = '';
  function updateHud() {
    const obj = objectiveText();
    if (obj !== lastObj) {
      lastObj = obj;
      $('objText').textContent = obj;
    }
    const items = bag().map((c) => CRATE_LABEL[c.id]);
    const bagKey = `${items.join('|')}#${s.stockKg}`;
    if (bagKey !== lastBag) {
      lastBag = bagKey;
      const bagEl = $('bagText');
      bagEl.replaceChildren();
      const b = document.createElement('div');
      b.textContent = `Túi ${items.length}/${BAG_SLOTS}`;
      b.style.fontWeight = '700';
      bagEl.append(b);
      items.forEach((t) => {
        const d = document.createElement('div');
        d.className = 'row';
        d.textContent = t;
        bagEl.append(d);
      });
      $('stockText').textContent = `Kho vật liệu: ${fmt(s.stockKg)} kg`;
    }

    const v = version();
    const rad = $('rad');
    if (v && s.domeDone) {
      const lv = findLevel(v.arealDensity)!;
      const acc = accumulatedMicroSv(lv.gcr, v.recordedSec);
      const radKey = `${v.id}|${v.name}|${s.recording}|${fmt(acc, 3)}`;
      if (radKey !== lastRad) {
        lastRad = radKey;
        rad.style.display = 'block';
        rad.replaceChildren();
        const l1 = document.createElement('div');
        l1.textContent = `${v.id} · ${v.name} · ${v.arealDensity} g/cm²`;
        const l2 = document.createElement('div');
        const bold = document.createElement('b');
        bold.textContent = `${fmt(lv.gcr, 4)} mSv/ngày`;
        l2.append('GCR phantom: ', bold);
        const l3 = document.createElement('div');
        l3.textContent = `Tích lũy ${s.recording ? '(đang ghi)' : '(tắt ghi)'}: ${fmt(acc, 3)} µSv`;
        rad.append(l1, l2, l3);
      }
    } else if (lastRad !== '') {
      lastRad = '';
      rad.style.display = 'none';
    }
  }

  // ---------- Tương tác ----------
  function spots(): Spot[] {
    const list: Spot[] = [];
    for (const c of s.crates) if (c.where === 'world') list.push({ kind: 'crate', x: c.x, z: c.z, range: 2.1, crate: c });
    list.push({ kind: 'workshop', ...POS.workshopDoor, range: 2.6 });
    list.push({ kind: 'pedestal', ...POS.pedestal, range: 2.8 });
    list.push({ kind: 'console', ...POS.console, range: 2 });
    list.push({ kind: 'mica', ...POS.mica, range: 2.4 });
    return list;
  }

  function promptFor(sp: Spot): string | null {
    switch (sp.kind) {
      case 'crate':
        return bag().length >= BAG_SLOTS
          ? `Túi đầy ${BAG_SLOTS}/${BAG_SLOTS}. Bấm Q để đặt đồ xuống`
          : `Bấm E: Mang theo ${CRATE_LABEL[sp.crate!.id]}`;
      case 'workshop':
        return s.m1Done ? 'Xưởng đã sẵn sàng' : 'Bấm E: Giao đồ cho xưởng';
      case 'pedestal':
        return hasBag('phantom') || hasBag('logger') ? 'Bấm E: Đặt thiết bị lên bệ' : null;
      case 'console':
        return 'Bấm E: Mở màn hình bệ';
      case 'mica':
        return 'Bấm E: Nói chuyện với MICA';
    }
  }

  function interact(sp: Spot) {
    switch (sp.kind) {
      case 'crate': {
        const c = sp.crate!;
        if (bag().length >= BAG_SLOTS) return radio('Hệ thống', 'Túi đã đầy. Bấm Q để đặt bớt đồ xuống.');
        c.where = 'bag';
        if (c.id === 'logger') radio('An', 'Đúng nhãn rồi. Bộ ghi dữ liệu đã trong túi.');
        else if (c.id === 'phantom') radio('An', 'Mô hình cơ thể nghiên cứu, chú ý đừng làm rơi.');
        else radio('An', 'Một kiện vật tư phụ. Bên trong có biển tên cho trạm của bạn.');
        break;
      }
      case 'workshop': {
        if (s.m1Done) return radio('An', 'Xưởng và thiết bị nghiên cứu đã sẵn sàng.');
        if (hasBag('logger') && hasBag('phantom')) {
          s.m1Done = true;
          radio('An', 'Đủ đồ rồi. Trưởng đoàn muốn bố trí khu nghiên cứu thế nào? Bệ nghiên cứu ở phía đông.');
        } else {
          radio('An', 'Chưa đủ hai kiện: bộ ghi dữ liệu và mô hình cơ thể. Chúng ở các điểm khảo sát quanh khu đất.');
        }
        break;
      }
      case 'pedestal': {
        let any = false;
        for (const id of ['phantom', 'logger'] as const) {
          if (hasBag(id)) {
            crate(id).where = 'placed';
            any = true;
          }
        }
        if (any) {
          if (placed('phantom') && placed('logger')) radio('MICA', 'Thiết bị đã vào vị trí. Tôi chờ ý tưởng của bạn.');
          else radio('Hệ thống', 'Đã đặt thiết bị. Còn thiếu một kiện nữa.');
        }
        break;
      }
      case 'console':
        openBook();
        break;
      case 'mica':
        openChat();
        break;
    }
    persist();
  }

  function dropOne() {
    const items = bag();
    if (!items.length) return;
    const c = items[items.length - 1];
    c.where = 'world';
    c.x = player.position.x + Math.sin(player.rotation.y) * 1.2;
    c.z = player.position.z + Math.cos(player.rotation.y) * 1.2;
    radio('Hệ thống', `Đã đặt ${CRATE_LABEL[c.id]} xuống. Bạn có thể quay lại lấy.`);
    persist();
  }

  // ---------- Panel ----------
  function openPanel(id: string) {
    for (const p of document.querySelectorAll<HTMLElement>('.panel')) p.style.display = 'none';
    $(id).style.display = 'block';
    uiOpen = true;
    document.exitPointerLock?.();
  }
  function closePanels() {
    for (const p of document.querySelectorAll<HTMLElement>('.panel')) p.style.display = 'none';
    uiOpen = false;
    clearGhost();
    (document.activeElement as HTMLElement | null)?.blur();
  }
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', closePanels));

  // ---- MICA ----
  const manual = $<HTMLSelectElement>('manual');
  for (const l of LEVELS) {
    const o = document.createElement('option');
    o.value = String(l.arealDensity);
    o.textContent = `${l.arealDensity} g/cm²`;
    manual.append(o);
  }
  manual.value = '10';

  function chatLine(cls: string, who: string, text: string, tag?: { label: string; ai: boolean }) {
    const p = document.createElement('p');
    p.className = cls;
    const b = document.createElement('b');
    b.textContent = `${who}: `;
    p.append(b, document.createTextNode(text));
    if (tag) {
      const t = document.createElement('span');
      t.className = tag.ai ? 'tag ai' : 'tag';
      t.textContent = tag.label;
      p.append(t);
    }
    $('chatlog').append(p);
    $('chatlog').scrollTop = 1e6;
  }

  function selectedLevel(): number {
    return Number(manual.value);
  }

  function preview() {
    clearGhost();
    const v = validateConfig({ arealDensity: selectedLevel() });
    if (!v.ok) return;
    ghost = makeDome(v.arealDensity, true);
    scene.add(ghost);
    updateBuildNote();
  }

  function updateBuildNote() {
    const a = selectedLevel();
    const mass = shellMassKg(a);
    const old = version();
    const refund = old && s.currentVersion >= 0 ? shellMassKg(old.arealDensity) : 0;
    const avail = s.stockKg + refund;
    const parts = [describeLevel(a), `Kho khả dụng: ${fmt(avail)} kg${refund ? ' (đã tính hoàn vật liệu từ vòm cũ)' : ''}`];
    if (mass > avail) parts.push('Không đủ vật liệu.');
    if (!(placed('phantom') && placed('logger'))) parts.push('Cần đặt mô hình cơ thể và bộ ghi lên bệ trước.');
    $('buildNote').textContent = parts.join(' · ');
  }

  function renderPlan(plan: Plan) {
    lastPlan = plan;
    chatLine('mica', 'MICA', plan.message, plan.source === 'ai' ? { label: 'AI', ai: true } : { label: 'Mẫu dự phòng, không phải AI', ai: false });
    const box = $('opts');
    box.replaceChildren();
    plan.options.forEach((o, i) => {
      const d = document.createElement('div');
      d.className = 'opt';
      const h = document.createElement('div');
      h.className = 'h';
      h.textContent = `${o.title} · ${o.arealDensity} g/cm²`;
      const m = document.createElement('div');
      m.className = 'm';
      m.textContent = describeLevel(o.arealDensity);
      const r = document.createElement('div');
      r.className = 'r';
      r.textContent = o.reason;
      d.append(h, m, r);
      d.addEventListener('click', () => {
        manual.value = String(o.arealDensity);
        box.querySelectorAll('.opt').forEach((e) => e.classList.remove('sel'));
        d.classList.add('sel');
        preview();
      });
      box.append(d);
      if (i === 0) d.click();
    });
  }

  function openChat() {
    openPanel('chat');
    if (!$('chatlog').childElementCount) chatLine('mica', 'MICA', 'Tôi chờ ý tưởng của bạn. Bạn muốn che chắn thế nào?');
    updateBuildNote();
    setTimeout(() => $<HTMLTextAreaElement>('chatIn').focus(), 0);
  }

  let sending = false;
  async function send() {
    const input = $<HTMLTextAreaElement>('chatIn');
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    chatLine('me', 'Bạn', text);
    $<HTMLButtonElement>('chatSend').disabled = true;
    chatLine('mica', 'MICA', 'Đang suy nghĩ...');
    const plan = await planDesign(text);
    $('chatlog').lastElementChild?.remove();
    renderPlan(plan);
    $<HTMLButtonElement>('chatSend').disabled = false;
    sending = false;
  }
  $('chatSend').addEventListener('click', send);
  $('chatIn').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
      e.preventDefault();
      void send();
    }
  });
  document.querySelectorAll<HTMLElement>('[data-tpl]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = Number(b.dataset.tpl);
      chatLine('mica', 'MICA', `Mẫu có sẵn ${a} g/cm². Bạn xem hình rồi quyết định xây nhé.`, { label: 'Mẫu có sẵn', ai: false });
      manual.value = String(a);
      preview();
    }),
  );
  manual.addEventListener('change', preview);
  $('previewBtn').addEventListener('click', preview);

  $('buildBtn').addEventListener('click', () => {
    const v = validateConfig({ arealDensity: selectedLevel() });
    if (!v.ok) return void ($('buildNote').textContent = v.reason);
    if (building()) return void ($('buildNote').textContent = 'MICA đang thi công, hãy chờ xong.');
    if (!(placed('phantom') && placed('logger'))) {
      return void ($('buildNote').textContent = 'Cần đặt mô hình cơ thể và bộ ghi lên bệ trước khi đóng vòm.');
    }
    const old = version();
    const refund = old ? shellMassKg(old.arealDensity) : 0;
    const mass = shellMassKg(v.arealDensity);
    if (mass > s.stockKg + refund) return void ($('buildNote').textContent = 'Không đủ vật liệu trong kho.');
    // Hợp lệ: thực hiện một lần.
    s.stockKg += refund - mass;
    const name = $<HTMLInputElement>('nameIn').value.trim() || `Mầm ${String(s.versions.length + 1).padStart(2, '0')}`;
    s.versions.push({ id: `V${s.versions.length + 1}`, name, arealDensity: v.arealDensity, recordedSec: 0 });
    s.currentVersion = s.versions.length - 1;
    s.domeDone = false;
    s.recording = false;
    buildT = 0;
    showDome(v.arealDensity, 0.02);
    clearGhost();
    closePanels();
    radio('MICA', `Nhận lệnh. Đang thi công "${name}" (${v.arealDensity} g/cm²).`);
    persist();
  });

  // ---- Màn hình bệ ----
  function renderBook() {
    const v = version();
    $('bookSub').textContent = v
      ? `Công trình hiện tại: ${v.id} "${v.name}" · ${building() ? 'đang xây' : s.recording ? 'đang ghi' : 'đã xây, chưa ghi'}`
      : 'Chưa có công trình nào.';
    const ready = !!v && s.domeDone;
    $<HTMLButtonElement>('recBtn').disabled = !ready;
    $('recBtn').textContent = s.recording ? 'Tắt ghi' : 'Bật ghi';
    $<HTMLButtonElement>('cutBtn').disabled = !dome;
    $('cutBtn').textContent = cutaway ? 'Tắt cắt lớp' : 'Xem cắt lớp';
    const ok = ready && s.m2Done && meetsHandover(v!.arealDensity);
    $<HTMLButtonElement>('handBtn').disabled = !ok;
    $('handBtn').title = ok ? '' : 'Cần ghi đủ 60 giây và thiết kế đạt yêu cầu bàn giao.';
    const tb = $('vers');
    tb.replaceChildren();
    s.versions.forEach((x, i) => {
      const lv = findLevel(x.arealDensity)!;
      const tr = document.createElement('tr');
      const cells = [
        i === s.currentVersion ? `${x.id} ●` : x.id,
        x.name,
        String(x.arealDensity),
        fmt(lv.gcr, 4),
        fmt(shellMassKg(x.arealDensity)),
        `${Math.floor(x.recordedSec)} s · ${fmt(accumulatedMicroSv(lv.gcr, x.recordedSec), 3)} µSv`,
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.append(td);
      }
      tb.append(tr);
    });
  }
  function openBook() {
    renderBook();
    openPanel('book');
  }
  $('recBtn').addEventListener('click', () => {
    if (!s.domeDone) return;
    s.recording = !s.recording;
    radio('Hệ thống', s.recording ? 'Đã bật ghi dữ liệu.' : 'Đã tắt ghi. Bức xạ vẫn tác động trong mô hình.');
    renderBook();
    persist();
  });
  $('cutBtn').addEventListener('click', () => {
    cutaway = !cutaway;
    applyCut();
    renderBook();
  });
  $('handBtn').addEventListener('click', () => {
    const v = version();
    if (!v || !s.m2Done || !meetsHandover(v.arealDensity)) return;
    s.handedOver = true;
    persist();
    closePanels();
    showEnding();
  });

  function showEnding() {
    const v = version()!;
    const lv = findLevel(v.arealDensity)!;
    const mass = shellMassKg(v.arealDensity);
    const ach: string[] = ['Hoàn thành chương đầu'];
    if (crate('bonus').where !== 'world') ach.push('Tìm thấy kiện phụ');
    if (mass <= 2600) ach.push('Phương án ít vật liệu');
    if (lv.gcr <= 0.62) ach.push('Kết quả tham chiếu tốt');
    if (s.versions.length > 1) ach.push('Đã cải tiến thiết kế');
    const ov = $('overlay');
    const box = $('ovBox');
    box.replaceChildren();
    const h = document.createElement('h1');
    h.textContent = 'Trạm đã có tên';
    const p1 = document.createElement('p');
    p1.textContent = `Khu nghiên cứu "${v.name}" (${v.arealDensity} g/cm², GCR ${fmt(lv.gcr, 4)} mSv/ngày, vỏ ${fmt(mass)} kg) được bàn giao cho đoàn sau. Sổ thiết kế ghi lại ${s.versions.length} phiên bản.`;
    const p2 = document.createElement('p');
    p2.textContent = `Thành tích: ${ach.join(' · ')}`;
    const p3 = document.createElement('p');
    p3.textContent = 'Kết quả thuộc mô hình phantom tham chiếu, chưa phải liều của nhân vật hay bằng chứng vòm có thể làm nơi ở.';
    const btn = document.createElement('button');
    btn.className = 'pri';
    btn.textContent = 'Tiếp tục thiết kế';
    btn.addEventListener('click', () => {
      ov.style.display = 'none';
      uiOpen = false;
    });
    box.append(h, p1, p2, p3, btn);
    ov.style.display = 'flex';
    uiOpen = true;
  }

  // ---------- Điều khiển ----------
  const keys = new Set<string>();
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement;
  // Dùng e.code (phím vật lý) để WASD vẫn chạy khi đang bật bộ gõ tiếng Việt.
  const norm = (e: KeyboardEvent) =>
    e.code ? (e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.code.toLowerCase()) : e.key.toLowerCase();
  const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  let moveTarget: THREE.Vector3 | null = null;

  window.addEventListener('keydown', (e) => {
    if (typing(e.target)) {
      if (e.code === 'Escape') closePanels();
      return;
    }
    const k = norm(e);
    if (k === 'escape') return closePanels();
    if (k === 'p') {
      paused = !paused;
      $('paused').style.display = paused ? 'block' : 'none';
      return;
    }
    if (uiOpen) return;
    if (k === 'v' && !e.repeat) {
      setView(!fpv);
      return;
    }
    if (MOVE_KEYS.has(k)) {
      e.preventDefault();
      moveTarget = null; // phím huỷ lệnh click-to-move
    }
    keys.add(k);
    if (k === 'e' && !paused && !e.repeat) {
      const sp = nearest();
      if (sp) interact(sp);
    }
    if (k === 'q' && !paused && !e.repeat) dropOne();
  });
  window.addEventListener('keyup', (e) => keys.delete(norm(e)));
  window.addEventListener('blur', () => keys.clear());

  // Click chuột lên mặt đất để đi tới đó.
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.38, 32),
    new THREE.MeshBasicMaterial({ color: 0x4ee6c0, transparent: true, opacity: 0.9, fog: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || uiOpen || paused) return;
    if (fpv) {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      return;
    }
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(groundPlane, hit)) {
      // tinh chỉnh theo độ cao thật để click trúng sườn đồi
      groundPlane.constant = -heightAt(hit.x, hit.z);
      ray.ray.intersectPlane(groundPlane, hit);
      groundPlane.constant = 0;
      hit.x = THREE.MathUtils.clamp(hit.x, -WORLD_HALF, WORLD_HALF);
      hit.z = THREE.MathUtils.clamp(hit.z, -WORLD_HALF, WORLD_HALF);
      moveTarget = hit;
    }
  });

  function setView(on: boolean) {
    fpv = on;
    player.visible = !on;
    camera.fov = on ? 72 : 40;
    camera.near = on ? 0.05 : 0.1;
    camera.updateProjectionMatrix();
    $('cross').style.display = on ? 'block' : 'none';
    $('viewBtn').textContent = `Góc nhìn: ${on ? 'Thứ 1' : 'Thứ 3'} (V)`;
    if (on) {
      fpYaw = player.rotation.y;
      fpPitch = 0;
      moveTarget = null;
      marker.visible = false;
      camera.rotation.order = 'YXZ';
    } else {
      document.exitPointerLock?.();
    }
  }
  $('viewBtn').addEventListener('click', (e) => {
    setView(!fpv);
    (e.currentTarget as HTMLElement).blur();
  });
  document.addEventListener('mousemove', (e) => {
    if (!fpv || uiOpen || paused || document.pointerLockElement !== canvas) return;
    fpYaw -= e.movementX * 0.0022;
    fpPitch = THREE.MathUtils.clamp(fpPitch - e.movementY * 0.0022, -1.25, 1.25);
  });

  const QLABEL: Record<Quality, string> = { auto: 'Tự động', high: 'Cao', low: 'Thấp' };
  function applyQuality(q: Quality) {
    quality = q;
    try {
      localStorage.setItem('hd.quality', q);
    } catch {
      // bỏ qua
    }
    maxPR = prFor(q);
    minPR = q === 'low' ? 0.6 : 0.9;
    bloom.enabled = q !== 'low';
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      rt.samples = q === 'low' ? 0 : 4;
      rt.dispose();
    }
    const sz = q === 'low' ? 1024 : q === 'high' ? 2048 : 1536;
    world.dir.shadow.mapSize.set(sz, sz);
    world.dir.shadow.map?.dispose();
    world.dir.shadow.map = null;
    setPixelRatio(maxPR);
    $('qBtn').textContent = `Đồ họa: ${QLABEL[q]}`;
  }
  $('qBtn').addEventListener('click', (e) => {
    applyQuality(quality === 'auto' ? 'high' : quality === 'high' ? 'low' : 'auto');
    (e.currentTarget as HTMLElement).blur();
  });

  function nearest(): Spot | null {
    let best: Spot | null = null;
    let bd = Infinity;
    for (const sp of spots()) {
      const d = Math.hypot(sp.x - player.position.x, sp.z - player.position.z);
      if (fpv && d > 1.3) {
        const facing = ((sp.x - player.position.x) / d) * Math.sin(fpYaw) + ((sp.z - player.position.z) / d) * Math.cos(fpYaw);
        if (facing < 0.35) continue;
      }
      if (d <= sp.range && d < bd && promptFor(sp)) {
        best = sp;
        bd = d;
      }
    }
    return best;
  }

  // ---------- Vòng lặp ----------
  function collide(p: THREE.Vector3) {
    const R = 0.4;
    for (const c of world.circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + R;
      if (d < min && d > 1e-4) {
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    for (const b of world.boxes) {
      if (p.x > b.minX - R && p.x < b.maxX + R && p.z > b.minZ - R && p.z < b.maxZ + R) {
        const l = p.x - (b.minX - R);
        const r = b.maxX + R - p.x;
        const t = p.z - (b.minZ - R);
        const bt = b.maxZ + R - p.z;
        const m = Math.min(l, r, t, bt);
        if (m === l) p.x = b.minX - R;
        else if (m === r) p.x = b.maxX + R;
        else if (m === t) p.z = b.minZ - R;
        else p.z = b.maxZ + R;
      }
    }
    p.x = THREE.MathUtils.clamp(p.x, -WORLD_HALF, WORLD_HALF);
    p.z = THREE.MathUtils.clamp(p.z, -WORLD_HALF, WORLD_HALF);
  }

  function glow(o: THREE.Object3D, color: number) {
    o.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | undefined;
      if (!m) return;
      if ('emissive' in m) {
        m.emissive.set(color);
        m.color.set(color);
      } else {
        m.color.set(color);
      }
    });
  }

  // Tự điều chỉnh độ phân giải để giữ ~50+ FPS trên máy yếu.
  let emaMs = 16;
  let qualityT = 0;
  function setPixelRatio(v: number) {
    curPR = v;
    renderer.setPixelRatio(v);
    composer.setPixelRatio(v);
    resize();
  }

  const clock = new THREE.Clock();
  let elapsed = 0;
  let saveT = 0;
  const camOff = new THREE.Vector3(13, 15, 13);
  const camTarget = new THREE.Vector3();
  camera.position.copy(player.position).add(camOff);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Khởi tạo theo trạng thái lưu
  const cur = version();
  if (cur) {
    s.domeDone = true; // công trình đang xây dở khi lưu được coi như đã xong
    showDome(cur.arealDensity, 1);
  }
  radio('An', s.m1Done ? 'Chào mừng quay lại, trưởng đoàn.' : 'Bộ ghi dữ liệu còn ở điểm khảo sát. Bạn đi tìm giúp nhé, trưởng đoàn.');

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const step = paused ? 0 : dt;
    elapsed += dt;
    if (!paused && document.visibilityState === 'visible') {
      emaMs += (dt * 1000 - emaMs) * 0.06;
      qualityT += dt;
      if (qualityT > 1.5) {
        qualityT = 0;
        if (quality !== 'auto') {
          // chế độ cố định: không tự đổi độ phân giải
        } else if (emaMs > 26 && curPR > minPR) setPixelRatio(Math.max(minPR, +(curPR - 0.1).toFixed(2)));
        else if (emaMs < 14 && curPR < maxPR) setPixelRatio(Math.min(maxPR, +(curPR + 0.1).toFixed(2)));
      }
    }

    // di chuyển: vận tốc có quán tính, xoay mượt, tay chân lắc theo quãng đường
    {
      let ix = 0;
      let iz = 0;
      if (!uiOpen && !paused && fpv) {
        const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
        const st = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
        if (keys.has('arrowleft')) fpYaw += 1.9 * dt;
        if (keys.has('arrowright')) fpYaw -= 1.9 * dt;
        const fx = Math.sin(fpYaw);
        const fz = Math.cos(fpYaw);
        ix = fx * f - fz * st;
        iz = fz * f + fx * st;
      } else if (!uiOpen && !paused) {
        if (keys.has('w') || keys.has('arrowup')) { ix -= 1; iz -= 1; }
        if (keys.has('s') || keys.has('arrowdown')) { ix += 1; iz += 1; }
        if (keys.has('a') || keys.has('arrowleft')) { ix -= 1; iz += 1; }
        if (keys.has('d') || keys.has('arrowright')) { ix += 1; iz -= 1; }
      }
      const sprint = keys.has('shiftleft') || keys.has('shiftright');
      const maxSpeed = sprint ? 8 : 5.2;
      let wantX = 0;
      let wantZ = 0;
      const il = Math.hypot(ix, iz);
      if (il > 0) {
        wantX = (ix / il) * maxSpeed;
        wantZ = (iz / il) * maxSpeed;
      } else if (moveTarget && !uiOpen && !paused) {
        const dx = moveTarget.x - player.position.x;
        const dz = moveTarget.z - player.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.2) {
          moveTarget = null;
        } else {
          const sp = maxSpeed * Math.min(1, dist / 1.6); // giảm tốc khi tới gần
          wantX = (dx / dist) * sp;
          wantZ = (dz / dist) * sp;
        }
      }
      marker.visible = !!moveTarget;
      if (moveTarget) {
        marker.position.set(moveTarget.x, heightAt(moveTarget.x, moveTarget.z) + 0.06, moveTarget.z);
        marker.scale.setScalar(1 + Math.sin(elapsed * 8) * 0.12);
      }

      // tăng tốc nhanh hơn giảm tốc một chút → cảm giác có đà nhưng không trôi
      const rate = wantX !== 0 || wantZ !== 0 ? 11 : 8;
      const k = 1 - Math.exp(-rate * dt);
      vel.x += (wantX - vel.x) * k;
      vel.z += (wantZ - vel.z) * k;
      if (Math.abs(vel.x) < 0.01) vel.x = 0;
      if (Math.abs(vel.z) < 0.01) vel.z = 0;

      const px = player.position.x;
      const pz = player.position.z;
      player.position.x += vel.x * dt;
      player.position.z += vel.z * dt;
      collide(player.position);
      const moved = dt > 0 ? Math.hypot(player.position.x - px, player.position.z - pz) / dt : 0; // tốc độ thật sau va chạm

      // xoay thân theo hướng đi, mượt
      if (fpv) {
        player.rotation.y = fpYaw;
      } else if (moved > 0.4) {
        const target = Math.atan2(vel.x, vel.z);
        const diff = Math.atan2(Math.sin(target - player.rotation.y), Math.cos(target - player.rotation.y));
        player.rotation.y += diff * (1 - Math.exp(-14 * dt));
      }

      // chu kỳ bước theo quãng đường, biên độ theo tốc độ
      const ampTarget = Math.min(1, moved / 5.2);
      swingAmp += (ampTarget - swingAmp) * (1 - Math.exp(-10 * dt));
      walk += moved * dt * 2.7;
      const sw = Math.sin(walk) * swingAmp;
      const bob = Math.abs(Math.sin(walk)) * 0.05 * swingAmp;
      if (limbs.legL) limbs.legL.rotation.x = sw * 0.75;
      if (limbs.legR) limbs.legR.rotation.x = -sw * 0.75;
      if (limbs.armL) limbs.armL.rotation.x = -sw * 0.55;
      if (limbs.armR) limbs.armR.rotation.x = sw * 0.55;
      player.rotation.order = 'YXZ';
      const leanTarget = Math.min(1, moved / 5.2) * (sprint ? 0.16 : 0.08);
      player.rotation.x += (leanTarget - player.rotation.x) * (1 - Math.exp(-8 * dt));
      player.position.y = heightAt(player.position.x, player.position.z) + bob;
      player.scale.y = 1 + Math.sin(elapsed * 1.8) * 0.004 * (1 - swingAmp); // thở khi đứng yên
    }

    // xây
    if (building() && step > 0) {
      buildT += step;
      const k = Math.min(1, buildT / BUILD_SECONDS);
      const e = 1 - Math.pow(1 - k, 3);
      dome?.scale.setScalar(Math.max(0.02, e));
      if (k >= 1) {
        buildT = -1;
        s.domeDone = true;
        dome?.scale.setScalar(1);
        const v = version();
        radio('MICA', `Vòm "${v?.name}" đã hoàn thành. Bạn muốn bật ghi khi nào cũng được.`);
        persist();
      }
    }

    // ghi dữ liệu
    const v = version();
    if (s.recording && s.domeDone && v && step > 0) {
      v.recordedSec += step;
      if (v.recordedSec >= RECORD_GOAL_SEC && !s.m2Done) {
        s.m2Done = true;
        radio('An', `Đã đủ ${RECORD_GOAL_SEC} giây dữ liệu. Giờ cần bàn giao một thiết kế đạt yêu cầu. Giữ bản này hoặc cải tiến đều được.`);
        persist();
      }
    }

    // kiện, phantom, MICA
    for (const c of s.crates) {
      const m = crateMesh.get(c.id)!;
      m.visible = c.where === 'world';
      m.position.set(c.x, heightAt(c.x, c.z), c.z);
      const mk = m.getObjectByName('marker');
      if (mk) mk.position.y = 1.8 + Math.sin(elapsed * 3 + c.x) * 0.15;
    }
    phantom.visible = placed('phantom');
    const toP = Math.atan2(player.position.x - mica.position.x, player.position.z - mica.position.z);
    mica.rotation.y += Math.atan2(Math.sin(toP - mica.rotation.y), Math.cos(toP - mica.rotation.y)) * Math.min(1, dt * 4);
    mica.position.y = Math.sin(elapsed * 2) * 0.04;
    const eye = mica.getObjectByName('eye') as THREE.Mesh;
    glow(eye, building() ? 0xffb454 : sending ? 0xffffff : 0x4ee6c0);
    const waving = building() ? Math.sin(elapsed * 9) * 0.7 : Math.sin(elapsed * 1.5) * 0.08;
    (mica.getObjectByName('armL') as THREE.Object3D).rotation.z = waving;
    (mica.getObjectByName('armR') as THREE.Object3D).rotation.z = -waving;
    if (ghost) ghost.rotation.y += dt * 0.3;

    // gợi ý & HUD
    const sp = !uiOpen && !paused ? nearest() : null;
    const pr = $('prompt');
    const ptxt = sp ? promptFor(sp) : null;
    if (ptxt !== lastPrompt) {
      lastPrompt = ptxt;
      pr.style.display = ptxt ? 'block' : 'none';
      if (ptxt) pr.textContent = ptxt;
    }
    updateHud();
    bookT += dt;
    if (bookT > 0.5) {
      bookT = 0;
      if ($('book').style.display === 'block') renderBook(); // làm mới màn hình bệ đang mở
    }

    // camera
    const gy = heightAt(player.position.x, player.position.z);
    if (fpv) {
      camera.position.set(player.position.x + Math.sin(fpYaw) * 0.1, player.position.y + 1.62, player.position.z + Math.cos(fpYaw) * 0.1);
      camera.rotation.set(fpPitch, fpYaw + Math.PI, 0);
      $('crossTip').style.display = document.pointerLockElement === canvas || uiOpen ? 'none' : 'block';
    } else {
      camTarget.copy(player.position).add(camOff);
      camTarget.y = gy + camOff.y;
      camTarget.x += vel.x * 0.25;
      camTarget.z += vel.z * 0.25;
      camera.position.lerp(camTarget, 1 - Math.exp(-dt * 5));
      camera.lookAt(player.position.x, gy + 0.8, player.position.z);
    }

    saveT += dt;
    if (saveT > 4) {
      saveT = 0;
      persist();
    }

    composer.render();
    requestAnimationFrame(tick);
  }
  window.addEventListener('beforeunload', persist);
  void lastPlan;
  if (import.meta.env.DEV) (window as unknown as { __hd: unknown }).__hd = { s, player, vel, heightAt, renderer, scene, camera, setView, applyQuality, getFp: () => ({ fpv, fpYaw, fpPitch }), interact, spots, openChat, openBook };
  applyQuality(quality);
  requestAnimationFrame(tick);
}
