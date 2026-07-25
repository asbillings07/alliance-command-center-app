/**
 * Shared column keyword constants and normalization helpers for spreadsheet imports.
 * Centralized to keep memberMatcher, ImportForm, and RosterImportForm synchronized.
 */

export const PLAYER_COLUMN_NAMES = new Set([
  "player",
  "player name",
  "playername",
  "member",
  "member name",
  "membername",
  "alliance member",
  "alliancemember",
  "name",
  "ign",
]);

export const THP_COLUMN_NAMES = new Set([
  "thp",
  "total hero power",
  "totalheropower",
  "hero power",
  "heropower",
  "power",
]);

export const ROLE_COLUMN_NAMES = new Set([
  "role",
  "rank",
  "position",
  "title",
  "r1",
  "r2",
  "r3",
  "r4",
  "r5",
]);

export const POWER_COLUMN_NAMES = new Set([
  "power",
  "total power",
  "power score",
  "vs score",
  "kill points",
]);

export function normalizeColumnName(name: string): string {
  return name.toLowerCase().trim().replace(/[-_]/g, " ").replace(/\s+/g, " ");
}

export function isPlayerColumn(columnName: string): boolean {
  const normalized = normalizeColumnName(columnName);
  const noSpaces = normalized.replace(/\s/g, "");
  return PLAYER_COLUMN_NAMES.has(normalized) || PLAYER_COLUMN_NAMES.has(noSpaces);
}

export type ColumnInfo = {
  index: number;
  name: string;
  isNumeric: boolean;
  sampleValues: string[];
};

export function detectColumn(columns: ColumnInfo[], knownNames: Set<string>): ColumnInfo | null {
  for (const col of columns) {
    const normalized = normalizeColumnName(col.name);
    const noSpaces = normalized.replace(/\s/g, "");
    if (knownNames.has(normalized) || knownNames.has(noSpaces)) {
      return col;
    }
  }
  return null;
}
