import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  calculateSimilarity,
  parseCSV,
  matchEntriesToMembers,
  matchMetricName,
} from './memberMatcher';

describe('normalizeName', () => {
  it('should lowercase the name', () => {
    expect(normalizeName('DRAGON')).toBe('dragon');
    expect(normalizeName('Dragon')).toBe('dragon');
  });

  it('should trim leading and trailing whitespace', () => {
    expect(normalizeName('  dragon  ')).toBe('dragon');
    expect(normalizeName('\tdragon\n')).toBe('dragon');
  });

  it('should collapse multiple spaces to single space', () => {
    expect(normalizeName('dragon  slayer')).toBe('dragon slayer');
    expect(normalizeName('dragon   slayer')).toBe('dragon slayer');
  });

  it('should handle combined normalizations', () => {
    expect(normalizeName('  DRAGON   SLAYER  ')).toBe('dragon slayer');
  });
});

describe('calculateSimilarity', () => {
  it('should return 1 for exact matches', () => {
    expect(calculateSimilarity('dragon', 'dragon')).toBe(1);
  });

  it('should return 1 for matches after normalization', () => {
    expect(calculateSimilarity('DRAGON', 'dragon')).toBe(1);
    expect(calculateSimilarity('  dragon  ', 'dragon')).toBe(1);
  });

  it('should return high similarity for small differences', () => {
    const similarity = calculateSimilarity('dragon', 'dragn');
    expect(similarity).toBeGreaterThan(0.8);
    expect(similarity).toBeLessThan(1);
  });

  it('should return lower similarity for larger differences', () => {
    const similarity = calculateSimilarity('dragon', 'phoenix');
    expect(similarity).toBeLessThan(0.5);
  });

  it('should handle empty strings', () => {
    expect(calculateSimilarity('', '')).toBe(1);
    expect(calculateSimilarity('dragon', '')).toBe(0);
  });
});

describe('parseCSV', () => {
  it('should parse a valid 2-column CSV with header', () => {
    const csv = `name,Kill Points
Dragon,1500
Val,2000`;
    const result = parseCSV(csv);
    
    expect(result.detectedMetricName).toBe('Kill Points');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ name: 'Dragon', value: 1500 });
    expect(result.entries[1]).toEqual({ name: 'Val', value: 2000 });
    expect(result.errors).toHaveLength(0);
  });

  it('should handle Windows line endings (CRLF)', () => {
    const csv = "name,Score\r\nDragon,1500\r\nVal,2000";
    const result = parseCSV(csv);
    
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle quoted fields with commas', () => {
    const csv = `name,Score
"Dragon, The Great",1500
Val,2000`;
    const result = parseCSV(csv);
    
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].name).toBe('Dragon, The Great');
  });

  it('should handle quoted fields with escaped quotes', () => {
    const csv = `name,Score
"Dragon ""The Great""",1500`;
    const result = parseCSV(csv);
    
    expect(result.entries[0].name).toBe('Dragon "The Great"');
  });

  it('should reject CSV with more than 2 columns', () => {
    const csv = `name,Rank,Score
Dragon,1,1500`;
    const result = parseCSV(csv);
    
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('3 columns');
    expect(result.errors[0]).toContain('only 2 are supported');
  });

  it('should report error for rows with missing values', () => {
    const csv = `name,Score
Dragon,1500
Val,`;
    const result = parseCSV(csv);
    
    expect(result.entries).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Invalid or missing value');
  });

  it('should report error for non-integer values', () => {
    const csv = `name,Score
Dragon,1500.5
Val,abc`;
    const result = parseCSV(csv);
    
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });

  it('should handle empty rows gracefully', () => {
    const csv = `name,Score
Dragon,1500

Val,2000`;
    const result = parseCSV(csv);
    
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should return error for empty CSV', () => {
    const result = parseCSV('');
    
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('empty');
  });

  it('should handle negative integers', () => {
    const csv = `name,Score
Dragon,-100`;
    const result = parseCSV(csv);
    
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].value).toBe(-100);
  });

  it('should trim whitespace from names and values', () => {
    const csv = `name,Score
  Dragon  ,  1500  `;
    const result = parseCSV(csv);
    
    expect(result.entries[0].name).toBe('Dragon');
    expect(result.entries[0].value).toBe(1500);
  });
});

describe('matchEntriesToMembers', () => {
  const members = [
    { id: '1', playerName: 'Dragon' },
    { id: '2', playerName: 'Val' },
    { id: '3', playerName: 'Mando' },
  ];

  it('should match exact names', () => {
    const entries = [
      { name: 'Dragon', value: 1500 },
      { name: 'Val', value: 2000 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(2);
    expect(result.unmatched).toBe(0);
    expect(result.results[0].status).toBe('matched');
    expect(result.results[0].memberId).toBe('1');
    expect(result.results[0].confidence).toBe(1);
  });

  it('should match names after normalization', () => {
    const entries = [
      { name: '  DRAGON  ', value: 1500 },
      { name: 'val', value: 2000 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(2);
    expect(result.results[0].confidence).toBe(1);
    expect(result.results[1].confidence).toBe(1);
  });

  it('should fuzzy match similar names', () => {
    const entries = [
      { name: 'Dragn', value: 1500 }, // missing 'o'
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(1);
    expect(result.results[0].matchedName).toBe('Dragon');
    expect(result.results[0].confidence).toBeGreaterThan(0.7);
    expect(result.results[0].confidence).toBeLessThan(1);
  });

  it('should mark unmatched entries', () => {
    const entries = [
      { name: 'Unknown Player', value: 1500 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.unmatched).toBe(1);
    expect(result.results[0].status).toBe('unmatched');
    expect(result.results[0].memberId).toBeUndefined();
  });

  it('should mark duplicate entries for same member', () => {
    const entries = [
      { name: 'Dragon', value: 1500 },
      { name: 'Dragon', value: 9999 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.results[0].status).toBe('matched');
    expect(result.results[1].status).toBe('duplicate');
  });

  it('should mark fuzzy duplicates correctly', () => {
    const entries = [
      { name: 'Dragon', value: 1500 },
      { name: 'DRAGON', value: 2000 },
      { name: 'dragon', value: 3000 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(1);
    expect(result.duplicates).toBe(2);
  });

  it('should preserve row order in results', () => {
    const entries = [
      { name: 'Val', value: 2000 },
      { name: 'Dragon', value: 1500 },
      { name: 'Mando', value: 3000 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.results[0].rawName).toBe('Val');
    expect(result.results[1].rawName).toBe('Dragon');
    expect(result.results[2].rawName).toBe('Mando');
  });

  it('should respect custom threshold', () => {
    const entries = [
      { name: 'Dragn', value: 1500 }, // ~83% match
    ];
    
    // With default 70% threshold - should match
    const result1 = matchEntriesToMembers(entries, members);
    expect(result1.matched).toBe(1);
    
    // With strict 90% threshold - should not match
    const result2 = matchEntriesToMembers(entries, members, { threshold: 0.9 });
    expect(result2.unmatched).toBe(1);
  });
});

describe('matchMetricName', () => {
  const metrics = [
    { id: 'm1', name: 'Kill Points' },
    { id: 'm2', name: 'VS Score' },
    { id: 'm3', name: 'Desert Storm' },
  ];

  it('should match exact metric name', () => {
    const result = matchMetricName('Kill Points', metrics);
    
    expect(result.status).toBe('matched');
    expect(result.metricId).toBe('m1');
    expect(result.metricName).toBe('Kill Points');
  });

  it('should match after normalization (case insensitive)', () => {
    const result = matchMetricName('kill points', metrics);
    
    expect(result.status).toBe('matched');
    expect(result.metricId).toBe('m1');
  });

  it('should match after normalization (whitespace)', () => {
    const result = matchMetricName('  Kill   Points  ', metrics);
    
    expect(result.status).toBe('matched');
    expect(result.metricId).toBe('m1');
  });

  it('should NOT fuzzy match similar metric names', () => {
    const result = matchMetricName('Kill Point', metrics); // missing 's'
    
    expect(result.status).toBe('unmatched');
    expect(result.metricId).toBeUndefined();
  });

  it('should return unmatched for unknown metric', () => {
    const result = matchMetricName('Unknown Metric', metrics);
    
    expect(result.status).toBe('unmatched');
    expect(result.detectedName).toBe('Unknown Metric');
  });

  it('should handle empty metric name', () => {
    const result = matchMetricName('', metrics);
    
    expect(result.status).toBe('unmatched');
  });
});
