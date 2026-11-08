// Bộ tính khoa học: chỉ tra bảng nguồn, không nội suy, không để AI đặt số.
// Nguồn: Matthiä & Berger (DLR, 2024), dữ liệu Zenodo 13365755 (GCR, phantom nam ICRP).

export const REGOLITH_DENSITY = 3; // g/cm³
export const INNER_RADIUS_M = 2; // m
export const SITE_STOCK_KG = 6000;
export const HANDOVER = { maxGcr: 0.7, maxMassKg: 6000 } as const;

export interface Level {
  arealDensity: number; // g/cm²
  gcr: number; // mSv/ngày, suất liều tương đương trung bình khối lượng toàn phantom
  gcrErr: number; // sai số thống kê nguồn
}

export const LEVELS: readonly Level[] = [
  { arealDensity: 5, gcr: 0.7235, gcrErr: 0.0082 },
  { arealDensity: 10, gcr: 0.659, gcrErr: 0.0071 },
  { arealDensity: 20, gcr: 0.6007, gcrErr: 0.0057 },
  { arealDensity: 45, gcr: 0.6272, gcrErr: 0.0053 },
];

export function findLevel(arealDensity: number): Level | undefined {
  return LEVELS.find((l) => l.arealDensity === arealDensity);
}

/** Độ dày vỏ (m) = mật độ bề mặt / mật độ regolith. */
export function shellThicknessM(arealDensity: number): number {
  return arealDensity / REGOLITH_DENSITY / 100;
}

/** Khối lượng vỏ bán cầu (kg), không gồm nền, khung hay thiết bị. */
export function shellMassKg(arealDensity: number): number {
  const r = INNER_RADIUS_M;
  const R = r + shellThicknessM(arealDensity);
  const volume = ((2 / 3) * Math.PI * (R ** 3 - r ** 3));
  return Math.round(volume * REGOLITH_DENSITY * 1000);
}

export type Validation =
  | { ok: true; arealDensity: number }
  | { ok: false; reason: string };

/** Mọi cấu hình (AI, mẫu, chỉnh tay) đều đi qua đây. */
export function validateConfig(input: unknown): Validation {
  const value = (input as { arealDensity?: unknown } | null)?.arealDensity;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: 'Thiếu mức che chắn hợp lệ.' };
  }
  if (!findLevel(value)) {
    const list = LEVELS.map((l) => l.arealDensity).join(', ');
    return { ok: false, reason: `Mức ${value} g/cm² chưa có dữ liệu. Chỉ hỗ trợ: ${list}.` };
  }
  return { ok: true, arealDensity: value };
}

export function meetsHandover(arealDensity: number): boolean {
  const level = findLevel(arealDensity);
  if (!level) return false;
  return level.gcr <= HANDOVER.maxGcr && shellMassKg(arealDensity) <= HANDOVER.maxMassKg;
}

/** µSv tích lũy = suất liều × thời gian, giả định trường tham chiếu không đổi. */
export function accumulatedMicroSv(gcrMsvPerDay: number, seconds: number): number {
  return (gcrMsvPerDay * 1000 * seconds) / 86400;
}
