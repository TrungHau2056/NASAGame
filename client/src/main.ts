import { loadAssets } from './assets';
import { startGame } from './game';
import { clearSave, freshState, loadState } from './state';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const box = document.getElementById('ovBox') as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function begin(resume: boolean) {
  if (!resume) clearSave();
  const state = (resume && loadState()) || freshState();
  overlay.style.display = 'none';
  startGame(canvas, state);
}

function showMenu() {
  box.replaceChildren();
  const saved = loadState();
  box.append(
    el('h1', 'HỪNG ĐÔNG'),
    el('p', 'Khám phá Mặt Trăng. Xây trạm của bạn. Học từ những điều xảy ra.'),
    el(
      'p',
      'Đoàn Hừng Đông vừa hạ cánh. Khu sinh hoạt đã sẵn sàng, nhưng vài kiện thiết bị còn ở điểm khảo sát. Hãy mang chúng về, rồi cùng robot MICA dựng khu nghiên cứu đầu tiên.',
    ),
  );
  const row = el('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:18px';
  const play = el('button', saved ? 'Chơi mới' : 'Bắt đầu', 'pri');
  play.addEventListener('click', () => begin(false));
  row.append(play);
  if (saved) {
    const cont = el('button', 'Tiếp tục');
    cont.addEventListener('click', () => begin(true));
    row.append(cont);
  }
  box.append(row, el('p', 'Bản demo hackathon · model 3D dựng bằng Blender.', 'note'));
  overlay.style.display = 'flex';
}

box.append(el('h1', 'HỪNG ĐÔNG'), el('p', 'Đang tải model 3D...'));
overlay.style.display = 'flex';
loadAssets((d, t) => {
  box.lastElementChild!.textContent = `Đang tải model 3D... ${d}/${t}`;
}).then(showMenu, showMenu);
