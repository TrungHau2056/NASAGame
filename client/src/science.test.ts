import { describe, expect, it } from 'vitest';
import {
  HANDOVER,
  accumulatedMicroSv,
  meetsHandover,
  shellMassKg,
  validateConfig,
} from './science';

describe('khối lượng vỏ vòm khớp tài liệu nguồn', () => {
  it.each([
    [5, 1267],
    [10, 2555],
    [20, 5196],
    [45, 12179],
  ])('%i g/cm² ≈ %i kg', (a, kg) => {
    expect(Math.abs(shellMassKg(a) - kg)).toBeLessThanOrEqual(2);
  });
});

describe('điều kiện bàn giao', () => {
  it('chỉ 10 và 20 g/cm² đạt', () => {
    expect([5, 10, 20, 45].filter(meetsHandover)).toEqual([10, 20]);
  });
  it('ngưỡng đúng như tài liệu', () => {
    expect(HANDOVER).toEqual({ maxGcr: 0.7, maxMassKg: 6000 });
  });
});

describe('validateConfig', () => {
  it('nhận mức có dữ liệu', () => {
    expect(validateConfig({ arealDensity: 10 })).toEqual({ ok: true, arealDensity: 10 });
  });
  it.each([{ arealDensity: 15 }, { arealDensity: '10' }, {}, null])('từ chối %j', (v) => {
    expect(validateConfig(v).ok).toBe(false);
  });
});

describe('tích lũy', () => {
  it('60 giây ở 0,659 mSv/ngày ≈ 0,458 µSv', () => {
    expect(accumulatedMicroSv(0.659, 60)).toBeCloseTo(0.4577, 3);
  });
});
