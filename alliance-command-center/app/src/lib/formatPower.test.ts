import { describe, it, expect } from 'vitest';
import { formatPower } from './formatPower';

describe('formatPower', () => {
  it('should return plain number for values under 1000', () => {
    expect(formatPower(850)).toBe('850');
    expect(formatPower(0)).toBe('0');
    expect(formatPower(999)).toBe('999');
  });

  it('should format thousands with K suffix', () => {
    expect(formatPower(12500)).toBe('12.5K');
    expect(formatPower(1000)).toBe('1K');
    expect(formatPower(5000)).toBe('5K');
  });

  it('should format millions with M suffix', () => {
    expect(formatPower(8200000)).toBe('8.2M');
    expect(formatPower(1000000)).toBe('1M');
    expect(formatPower(5000000)).toBe('5M');
  });

  it('should format billions with G suffix', () => {
    expect(formatPower(3100000000)).toBe('3.1G');
    expect(formatPower(1000000000)).toBe('1G');
  });

  it('should format trillions with T suffix', () => {
    expect(formatPower(1400000000000)).toBe('1.4T');
    expect(formatPower(1000000000000)).toBe('1T');
  });

  it('should not show .0 for whole numbers', () => {
    expect(formatPower(1000)).toBe('1K');
    expect(formatPower(1000000)).toBe('1M');
    expect(formatPower(1000000000)).toBe('1G');
    expect(formatPower(1000000000000)).toBe('1T');
  });

  it('should roll over to next suffix when rounding would produce 1000', () => {
    expect(formatPower(999950)).toBe('1M');
    expect(formatPower(999950000)).toBe('1G');
    expect(formatPower(999950000000)).toBe('1T');
  });
});
