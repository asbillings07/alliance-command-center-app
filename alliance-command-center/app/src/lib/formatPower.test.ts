import { describe, it, expect } from 'vitest';
import { formatPower } from './formatPower';

describe('formatPower', () => {
  it('should return plain number for values under 1 million', () => {
    expect(formatPower(850)).toBe('850');
  });

  it('should format thousands with K suffix', () => {
    expect(formatPower(12500)).toBe('12.5K');
  });

  it('should format millions with M suffix', () => {
    expect(formatPower(8200000)).toBe('8.2M');
  });

  it('should format billions with G suffix', () => {
    expect(formatPower(3100000000)).toBe('3.1G');
  });

  it('should format trillions with T suffix', () => {
    expect(formatPower(1400000000000)).toBe('1.4T');
  });

  it('should handle edge cases', () => {
    expect(formatPower(0)).toBe('0');
    expect(formatPower(999)).toBe('999');
    expect(formatPower(1000000)).toBe('1.0M');
  });
});
