import { SITE_STOCK_KG } from './science';

export type CrateId = 'logger' | 'phantom' | 'bonus';
export interface Crate {
  id: CrateId;
  where: 'world' | 'bag' | 'placed';
  x: number;
  z: number;
}
export interface Version {
  id: string;
  name: string;
  arealDensity: number;
  recordedSec: number;
}
export interface State {
  crates: Crate[];
  stockKg: number;
  versions: Version[];
  currentVersion: number; // -1 nếu chưa có
  domeDone: boolean;
  recording: boolean;
  m1Done: boolean;
  m2Done: boolean;
  handedOver: boolean;
  player: { x: number; z: number };
}

export const CRATE_LABEL: Record<CrateId, string> = {
  logger: 'Bộ ghi dữ liệu',
  phantom: 'Mô hình cơ thể (phantom)',
  bonus: 'Kiện vật tư phụ',
};

export function freshState(): State {
  return {
    crates: [
      { id: 'logger', where: 'world', x: -6, z: -14 },
      { id: 'phantom', where: 'world', x: 18, z: 14 },
      { id: 'bonus', where: 'world', x: -20, z: -4 },
    ],
    stockKg: SITE_STOCK_KG,
    versions: [],
    currentVersion: -1,
    domeDone: false,
    recording: false,
    m1Done: false,
    m2Done: false,
    handedOver: false,
    player: { x: 0, z: 8 },
  };
}

const KEY = 'hungdong.save.v1';

export function saveState(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // bỏ qua nếu không lưu được
  }
}

export function loadState(): State | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as State;
    if (!Array.isArray(s.crates) || !Array.isArray(s.versions)) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // bỏ qua
  }
}
