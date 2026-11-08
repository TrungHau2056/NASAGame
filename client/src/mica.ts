import { LEVELS, findLevel, meetsHandover, shellMassKg, validateConfig } from './science';

export interface Option {
  arealDensity: number;
  title: string;
  reason: string;
}
export interface Plan {
  message: string;
  options: Option[];
  source: 'ai' | 'fallback';
}

const fmt = (n: number) => n.toLocaleString('vi-VN');

export function describeLevel(a: number): string {
  const l = findLevel(a);
  if (!l) return '';
  const ok = meetsHandover(a) ? 'đạt' : 'chưa đạt';
  return `GCR ${l.gcr.toString().replace('.', ',')} mSv/ngày · vỏ ${fmt(shellMassKg(a))} kg · yêu cầu bàn giao: ${ok}`;
}

function option(a: number, title: string, reason: string): Option {
  return { arealDensity: a, title, reason };
}

/** Phản hồi dự phòng tại chỗ. Luôn được gắn nhãn, không giả làm AI. */
export function fallbackPlan(prompt: string): Plan {
  const p = prompt.toLowerCase();
  const isQuestion = /\?|tại sao|vì sao|là gì|giải thích/.test(p) && !/tạo|thiết kế|xây|làm/.test(p);
  if (isQuestion) {
    if (/sep|mặt trời|bùng phát/.test(p)) {
      return {
        source: 'fallback',
        options: [],
        message:
          'GCR là các hạt đến đều từ ngoài hệ Mặt Trời. SEP là các đợt bùng phát từ Mặt Trời, mỗi sự kiện chỉ có tổng kết quả. Bản này mô phỏng GCR theo thời gian, còn SEP chưa được hiển thị.',
      };
    }
    return {
      source: 'fallback',
      options: [],
      message:
        'Che chắn làm giảm một phần bức xạ, nhưng hạt GCR năng lượng rất cao vẫn xuyên qua và sinh hạt thứ cấp, nên vẫn còn bức xạ. Thêm vật liệu cũng có đánh đổi: từ 20 lên 45 g/cm² suất liều lại nhích lên (0,6007 → 0,6272 mSv/ngày) trong khi vỏ nặng hơn gấp đôi.',
    };
  }
  if (/tiết kiệm|ít vật liệu|nhẹ|rẻ/.test(p)) {
    return {
      source: 'fallback',
      message: 'Tôi ưu tiên ít vật liệu nhưng vẫn cố đạt yêu cầu bàn giao. Bạn xem ba phương án nhé.',
      options: [
        option(10, 'Cân bằng, tiết kiệm', `Vỏ ${fmt(shellMassKg(10))} kg, đạt yêu cầu bàn giao, còn dư kho để phát triển trạm.`),
        option(5, 'Nhẹ nhất', `Chỉ ${fmt(shellMassKg(5))} kg nhưng GCR 0,7235 vượt ngưỡng 0,70 nên chưa bàn giao được.`),
        option(20, 'Dư an toàn', `Suất liều thấp nhất, nhưng vỏ ${fmt(shellMassKg(20))} kg gần hết kho.`),
      ],
    };
  }
  if (/an toàn|giảm bức xạ|thấp nhất|tối đa|bảo vệ/.test(p)) {
    return {
      source: 'fallback',
      message: 'Tôi ưu tiên suất liều thấp. Lưu ý rằng dày hơn không phải lúc nào cũng tốt hơn.',
      options: [
        option(20, 'Suất liều thấp nhất', `GCR 0,6007 mSv/ngày, vỏ ${fmt(shellMassKg(20))} kg.`),
        option(10, 'Gần tối ưu, nhẹ hơn', `GCR 0,659 với vỏ chỉ ${fmt(shellMassKg(10))} kg.`),
        option(45, 'Dày nhất (không tốt hơn)', `Vỏ ${fmt(shellMassKg(45))} kg vượt kho 6.000 kg, GCR còn cao hơn mức 20.`),
      ],
    };
  }
  return {
    source: 'fallback',
    message: 'Đây là ba phương án trong họ vòm đang hỗ trợ.',
    options: [
      option(10, 'Phương án chuẩn', `Vỏ ${fmt(shellMassKg(10))} kg, đạt yêu cầu bàn giao.`),
      option(20, 'Che chắn dày hơn', `GCR thấp hơn, vỏ ${fmt(shellMassKg(20))} kg.`),
      option(5, 'Che chắn mỏng', 'Rất nhẹ, nhưng GCR 0,7235 chưa đạt ngưỡng bàn giao.'),
    ],
  };
}

interface RawPlan {
  message?: unknown;
  options?: unknown;
}

/** Lọc đầu ra của AI: chỉ giữ cấu hình hợp lệ, tối đa 3 phương án. */
export function sanitizePlan(raw: RawPlan): Plan | null {
  if (typeof raw.message !== 'string') return null;
  const seen = new Set<number>();
  const options: Option[] = [];
  if (Array.isArray(raw.options)) {
    for (const o of raw.options) {
      const v = validateConfig(o);
      if (!v.ok || seen.has(v.arealDensity)) continue;
      seen.add(v.arealDensity);
      const t = (o as { title?: unknown }).title;
      const r = (o as { reason?: unknown }).reason;
      options.push({
        arealDensity: v.arealDensity,
        title: typeof t === 'string' ? t.slice(0, 60) : `${v.arealDensity} g/cm²`,
        reason: typeof r === 'string' ? r.slice(0, 240) : '',
      });
      if (options.length === 3) break;
    }
  }
  return { message: raw.message.slice(0, 600), options, source: 'ai' };
}

export async function planDesign(prompt: string): Promise<Plan> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch('/api/mica', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, levels: LEVELS.map((l) => l.arealDensity) }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const plan = sanitizePlan(await res.json());
    if (plan) return plan;
  } catch {
    // rơi xuống phản hồi dự phòng
  }
  return fallbackPlan(prompt);
}
