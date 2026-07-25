import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  calculateSimilarity,
  analyzeCSV,
  parseCSV,
  parseMetricRows,
  matchEntriesToMembers,
  matchMetricName,
  detectTableBounds,
  isSummaryFooterRowLabel,
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

describe('analyzeCSV', () => {
  it('should detect columns and their types', () => {
    const csv = `Rank,Player,Score
1,Dragon,1500
2,Val,2000`;
    const result = analyzeCSV(csv);
    
    expect(result.error).toBeNull();
    expect(result.columns).toHaveLength(3);
    expect(result.rowCount).toBe(2);
    
    expect(result.columns[0].name).toBe('Rank');
    expect(result.columns[0].isNumeric).toBe(true);
    
    expect(result.columns[1].name).toBe('Player');
    expect(result.columns[1].isNumeric).toBe(false);
    
    expect(result.columns[2].name).toBe('Score');
    expect(result.columns[2].isNumeric).toBe(true);
  });

  it('should return sample values for each column', () => {
    const csv = `Name,Score
Dragon,1500
Val,2000`;
    const result = analyzeCSV(csv);
    
    expect(result.columns[0].sampleValues).toContain('Dragon');
    expect(result.columns[1].sampleValues).toContain('1500');
  });

  it('should return error for empty CSV', () => {
    const result = analyzeCSV('');
    expect(result.error).toContain('empty');
  });

  it('should return error for header-only CSV', () => {
    const result = analyzeCSV('Name,Score');
    expect(result.error).toContain('at least one data row');
  });

  it('should handle many columns', () => {
    const csv = `Rank,Player,S5 Kills,S5 Captures,Combined,Tier
1,Dragon,1500,800,2300,Gold
2,Val,2000,600,2600,Platinum`;
    const result = analyzeCSV(csv);
    
    expect(result.columns).toHaveLength(6);
    expect(result.columns.filter(c => c.isNumeric)).toHaveLength(4);
    expect(result.columns.filter(c => !c.isNumeric)).toHaveLength(2);
  });
});

describe('analyzeCSV', () => {
  it('should classify columns with period-grouped integers like 450.000.000 as numeric', () => {
    const csv = `Player,Kill Points,Power
Dragon,450.000.000,12.500.000
Val,"450,000,000",15,000,000`;
    const result = analyzeCSV(csv);

    expect(result.columns).toHaveLength(3);
    expect(result.columns[0].isNumeric).toBe(false);
    expect(result.columns[1].isNumeric).toBe(true);
    expect(result.columns[2].isNumeric).toBe(true);
  });
});

describe('parseCSV', () => {
  it('should parse a valid 2-column CSV with header', () => {
    const csv = `name,Kill Points
Dragon,1500
Val,2000`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.detectedMetricName).toBe('Kill Points');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ name: 'Dragon', value: 1500, rawValue: '1500', sourceRow: 2 });
    expect(result.entries[1]).toEqual({ name: 'Val', value: 2000, rawValue: '2000', sourceRow: 3 });
    expect(result.errors).toHaveLength(0);
  });

  it('should parse localized thousands separators strictly (450.000.000 and 450,000,000)', () => {
    const csv = `name,Kill Points
Dragon,450.000.000
Val,"450,000,000"`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ name: 'Dragon', value: 450000000, rawValue: '450.000.000', sourceRow: 2 });
    expect(result.entries[1]).toEqual({ name: 'Val', value: 450000000, rawValue: '450,000,000', sourceRow: 3 });
    expect(result.errors).toHaveLength(0);
  });

  it('should handle Windows line endings (CRLF)', () => {
    const csv = "name,Score\r\nDragon,1500\r\nVal,2000";
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle quoted fields with commas', () => {
    const csv = `name,Score
"Dragon, The Great",1500
Val,2000`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].name).toBe('Dragon, The Great');
  });

  it('should handle quoted fields with escaped quotes', () => {
    const csv = `name,Score
"Dragon ""The Great""",1500`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.entries[0].name).toBe('Dragon "The Great"');
  });

  it('should parse multi-column CSV with user-selected columns', () => {
    const csv = `Rank,Player,S5 Kills,S5 Captures
1,Dragon,1500,800
2,Val,2000,600`;
    const result = parseCSV(csv, { nameColumn: 1, valueColumn: 2 });
    
    expect(result.detectedMetricName).toBe('S5 Kills');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ name: 'Dragon', value: 1500, rawValue: '1500', sourceRow: 2 });
    expect(result.entries[1]).toEqual({ name: 'Val', value: 2000, rawValue: '2000', sourceRow: 3 });
  });

  it('should allow selecting different value columns', () => {
    const csv = `Player,Kills,Captures
Dragon,1500,800
Val,2000,600`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 2 });
    
    expect(result.detectedMetricName).toBe('Captures');
    expect(result.entries[0]).toEqual({ name: 'Dragon', value: 800, rawValue: '800', sourceRow: 2 });
    expect(result.entries[1]).toEqual({ name: 'Val', value: 600, rawValue: '600', sourceRow: 3 });
  });

  it('should skip rows with missing/blank values and place them in skippedBlankCells', () => {
    const csv = `name,Score
Dragon,1500
Val,`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.validEntries).toHaveLength(1);
    expect(result.validEntries[0]).toEqual({
      name: 'Dragon',
      value: 1500,
      rawValue: '1500',
      sourceRow: 2,
      columnIndex: 1,
      address: 'B2',
      metricName: 'Score',
    });
    expect(result.skippedBlankCells).toHaveLength(1);
    expect(result.skippedBlankCells[0]).toEqual({
      sourceRow: 3,
      columnIndex: 1,
      address: 'B3',
      rawName: 'Val',
      metricName: 'Score',
    });
  });

  it('should report error for non-integer values and preserve row entries with error', () => {
    const csv = `name,Score
Dragon,1500.5
Val,abc`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].error).toBeDefined();
    expect(result.entries[1].error).toBeDefined();
    expect(result.errors).toHaveLength(2);
  });

  it('should handle empty rows gracefully', () => {
    const csv = `name,Score
Dragon,1500

Val,2000`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.entries).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should return error for empty CSV', () => {
    const result = parseCSV('', { nameColumn: 0, valueColumn: 1 });
    
    expect(result.entries).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('empty');
  });

  it('should handle negative integers', () => {
    const csv = `name,Score
Dragon,-100`;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].value).toBe(-100);
  });

  it('should trim whitespace from names and values', () => {
    const csv = `name,Score
  Dragon  ,  1500  `;
    const result = parseCSV(csv, { nameColumn: 0, valueColumn: 1 });
    
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
      { name: 'Dragon', value: 1500, rawValue: '1500', sourceRow: 1 },
      { name: 'Val', value: 2000, rawValue: '2000', sourceRow: 2 },
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
      { name: '  DRAGON  ', value: 1500, rawValue: '1500', sourceRow: 1 },
      { name: 'val', value: 2000, rawValue: '2000', sourceRow: 2 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(2);
    expect(result.results[0].confidence).toBe(1);
    expect(result.results[1].confidence).toBe(1);
  });

  it('should fuzzy match similar names', () => {
    const entries = [
      { name: 'Dragn', value: 1500, rawValue: '1500', sourceRow: 1 }, // missing 'o'
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(1);
    expect(result.results[0].matchedName).toBe('Dragon');
    expect(result.results[0].confidence).toBeGreaterThan(0.7);
    expect(result.results[0].confidence).toBeLessThan(1);
  });

  it('should mark unmatched entries', () => {
    const entries = [
      { name: 'Unknown Player', value: 1500, rawValue: '1500', sourceRow: 1 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.unmatched).toBe(1);
    expect(result.results[0].status).toBe('unmatched');
    expect(result.results[0].memberId).toBeUndefined();
  });

  it('should mark duplicate entries for same member', () => {
    const entries = [
      { name: 'Dragon', value: 1500, rawValue: '1500', sourceRow: 1 },
      { name: 'Dragon', value: 9999, rawValue: '9999', sourceRow: 2 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.results[0].status).toBe('matched');
    expect(result.results[1].status).toBe('duplicate');
  });

  it('should mark fuzzy duplicates correctly', () => {
    const entries = [
      { name: 'Dragon', value: 1500, rawValue: '1500', sourceRow: 1 },
      { name: 'DRAGON', value: 2000, rawValue: '2000', sourceRow: 2 },
      { name: 'dragon', value: 3000, rawValue: '3000', sourceRow: 3 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.matched).toBe(1);
    expect(result.duplicates).toBe(2);
  });

  it('should preserve row order in results', () => {
    const entries = [
      { name: 'Val', value: 2000, rawValue: '2000', sourceRow: 1 },
      { name: 'Dragon', value: 1500, rawValue: '1500', sourceRow: 2 },
      { name: 'Mando', value: 3000, rawValue: '3000', sourceRow: 3 },
    ];
    const result = matchEntriesToMembers(entries, members);
    
    expect(result.results[0].rawName).toBe('Val');
    expect(result.results[1].rawName).toBe('Dragon');
    expect(result.results[2].rawName).toBe('Mando');
  });

  it('should respect custom threshold', () => {
    const entries = [
      { name: 'Dragn', value: 1500, rawValue: '1500', sourceRow: 1 }, // ~83% match
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

describe('detectTableBounds and resilient structured parsing', () => {
  it('detects header row index and table bounds ignoring leading title rows and trailing summary blocks', () => {
    const rows = [
      ['Alliance vs Alliance Season 5 Weekly Export'], // Row 0: Title banner
      [''], // Row 1: Blank spacer
      ['Player Name', 'VS Score', 'Kill Points'], // Row 2: Header row
      ['Alice', '1500', '800'], // Row 3: Data row 1
      ['Bob', '2000', '600'], // Row 4: Data row 2
      ['Total', '3500', '1400'], // Row 5: Summary row
    ];

    const bounds = detectTableBounds(rows);
    expect(bounds.headerRowIndex).toBe(2);
    expect(bounds.dataStartIndex).toBe(3);
    expect(bounds.dataEndIndex).toBe(5);
    expect(bounds.confidence).toBe('high');
    expect(bounds.needsConfirmation).toBe(false);
  });

  it('classifies sparse blank metric cells as skipped and valid cells as valid entries', () => {
    const rows = [
      ['Player', 'Kill Points'],
      ['Alice', '1500'],
      ['Bob', ''], // Blank metric cell
      ['Charlie', '2000'],
    ];

    const result = parseMetricRows(rows, { nameColumn: 0, valueColumn: 1 });
    expect(result.validEntries).toHaveLength(2);
    expect(result.validEntries[0].name).toBe('Alice');
    expect(result.validEntries[1].name).toBe('Charlie');

    expect(result.skippedBlankCells).toHaveLength(1);
    expect(result.skippedBlankCells[0]).toEqual({
      sourceRow: 3,
      columnIndex: 1,
      address: 'B3',
      rawName: 'Bob',
      metricName: 'Kill Points',
    });
  });

  it('classifies nonblank invalid numeric strings with exact cell address and column metric name', () => {
    const rows = [
      ['Player', 'Kill Points'],
      ['Alice', 'abc'],
      ['Bob', '#VALUE!'],
    ];

    const result = parseMetricRows(rows, { nameColumn: 0, valueColumn: 1 });
    expect(result.validEntries).toHaveLength(0);
    expect(result.invalidValueIssues).toHaveLength(2);

    expect(result.invalidValueIssues[0].rawName).toBe('Alice');
    expect(result.invalidValueIssues[0].address).toBe('B2');
    expect(result.invalidValueIssues[0].metricName).toBe('Kill Points');
    expect(result.invalidValueIssues[0].error).toMatch(/integer/i);

    expect(result.invalidValueIssues[1].rawName).toBe('Bob');
    expect(result.invalidValueIssues[1].address).toBe('B3');
    expect(result.invalidValueIssues[1].metricName).toBe('Kill Points');
    expect(result.invalidValueIssues[1].error).toMatch(/integer/i);
  });

  it('preserves accurate cell addresses after title row offset', () => {
    const rows = [
      ['Title Banner'],
      [''],
      ['Player', 'Score'],
      ['Alice', '100'],
      ['Bob', '200'],
    ];

    const bounds = detectTableBounds(rows);
    const result = parseMetricRows(rows, { nameColumn: 0, valueColumn: 1, tableBounds: bounds });

    expect(result.validEntries[0].address).toBe('B4');
    expect(result.validEntries[0].sourceRow).toBe(4);
    expect(result.validEntries[1].address).toBe('B5');
    expect(result.validEntries[1].sourceRow).toBe(5);
  });

  it('correctly distinguishes summary footer labels from player names like TotalWar, AverageJoe, SummaryKing', () => {
    expect(isSummaryFooterRowLabel('TotalWar')).toBe(false);
    expect(isSummaryFooterRowLabel('AverageJoe')).toBe(false);
    expect(isSummaryFooterRowLabel('SummaryKing')).toBe(false);
    expect(isSummaryFooterRowLabel('OverallLeader')).toBe(false);

    expect(isSummaryFooterRowLabel('Total')).toBe(true);
    expect(isSummaryFooterRowLabel('TOTAL')).toBe(true);
    expect(isSummaryFooterRowLabel('Grand Total')).toBe(true);
    expect(isSummaryFooterRowLabel('Average')).toBe(true);
    expect(isSummaryFooterRowLabel('Notes:')).toBe(true);
    expect(isSummaryFooterRowLabel('Total Score')).toBe(true);
  });

  it('does not drop valid player rows whose names start with summary keywords', () => {
    const rows = [
      ['Player', 'Kill Points'],
      ['Alice', '1000'],
      ['TotalWar', '1500'],
      ['AverageJoe', '2000'],
      ['SummaryKing', '2500'],
      ['Total', '7000'],
    ];

    const bounds = detectTableBounds(rows);
    expect(bounds.dataStartIndex).toBe(1);
    expect(bounds.dataEndIndex).toBe(5); // Stops at 'Total', including TotalWar, AverageJoe, SummaryKing

    const result = parseMetricRows(rows, { nameColumn: 0, valueColumn: 1, tableBounds: bounds });
    expect(result.validEntries).toHaveLength(4);
    expect(result.validEntries.map((e) => e.name)).toEqual([
      'Alice',
      'TotalWar',
      'AverageJoe',
      'SummaryKing',
    ]);
  });

  it('detects side-by-side table regions when multiple player columns are present', () => {
    const rows = [
      ['Player', 'Kill Points', '', '', 'Player Name', 'VS Score'],
      ['Alice', '1000', '', '', 'Bob', '2000'],
      ['Charlie', '1500', '', '', 'David', '2500'],
    ];

    const bounds = detectTableBounds(rows);
    expect(bounds.tableRegions).toHaveLength(2);
    expect(bounds.tableRegions[0].startColumn).toBe(0);
    expect(bounds.tableRegions[0].endColumn).toBe(3);
    expect(bounds.tableRegions[0].playerColumnIndex).toBe(0);

    expect(bounds.tableRegions[1].startColumn).toBe(4);
    expect(bounds.tableRegions[1].endColumn).toBe(5);
    expect(bounds.tableRegions[1].playerColumnIndex).toBe(4);

    expect(bounds.needsConfirmation).toBe(true);
  });

  it('requires confirmation when header detection confidence is low', () => {
    const rows = [
      ['Notes', 'Random Text', 'Stuff'],
      ['100', '200', '300'],
      ['400', '500', '600'],
    ];

    const bounds = detectTableBounds(rows);
    expect(bounds.confidence).toBe('low');
    expect(bounds.needsConfirmation).toBe(true);
  });

  it('demonstrates spacer row resilience across multiple consecutive empty rows', () => {
    const rows = [
      ['Player', 'Kill Points'],
      ['Alice', '1000'],
      ['', ''], // Empty row 1
      ['', ''], // Empty row 2 (consecutive spacer)
      ['Bob', '2000'], // Valid data row after spacers!
      ['Total', '3000'],
    ];

    const bounds = detectTableBounds(rows);
    expect(bounds.dataStartIndex).toBe(1);
    expect(bounds.dataEndIndex).toBe(5); // Includes Bob, stops at Total
  });

  it('discloses excluded data rows below dataEndIndex', () => {
    const rows = [
      ['Player', 'Kill Points'],
      ['Alice', '1000'],
      ['Total', '1000'],
      ['Footnote:', 'Extra observations below table'],
    ];

    const bounds = detectTableBounds(rows);
    expect(bounds.dataEndIndex).toBe(2);
    expect(bounds.hasExcludedDataBelow).toBe(true);
    expect(bounds.excludedRowsCount).toBe(2); // Total summary row + Footnote row
  });

  it('records missing identity issue with accurate nameAddress and cell address when value is present but player name is blank', () => {
    const rows = [
      ['Title Banner'],
      ['Player', 'Kill Points'],
      ['Alice', '1000'],
      ['', '1500'], // Missing player name in A4, value 1500 in B4
    ];

    const bounds = detectTableBounds(rows);
    const result = parseMetricRows(rows, { nameColumn: 0, valueColumn: 1, tableBounds: bounds });

    expect(result.validEntries).toHaveLength(1);
    expect(result.validEntries[0].name).toBe('Alice');

    expect(result.missingIdentityIssues).toHaveLength(1);
    expect(result.missingIdentityIssues[0]).toEqual({
      sourceRow: 4,
      columnIndex: 1,
      nameColumnIndex: 0,
      address: 'B4',
      nameAddress: 'A4',
      metricName: 'Kill Points',
      rawValue: '1500',
      error: 'Missing player name in cell A4',
    });
  });
});

