import type { TourDefinition } from "./types";
import { importMembersTour, IMPORT_MEMBERS_TOUR_ID } from "./importMembersTour";
import { createPeriodTour, CREATE_PERIOD_TOUR_ID } from "./createPeriodTour";
import { smartImportTour, SMART_IMPORT_TOUR_ID } from "./smartImportTour";

export type { TourStep, TourDefinition } from "./types";
export { importMembersTour, IMPORT_MEMBERS_TOUR_ID } from "./importMembersTour";
export { createPeriodTour, CREATE_PERIOD_TOUR_ID } from "./createPeriodTour";
export { smartImportTour, SMART_IMPORT_TOUR_ID } from "./smartImportTour";
export { buildTourHref, stripTourParams, TOUR_QUERY_PARAM } from "./tourLink";

/**
 * Tours resolvable by their stable id.
 *
 * A `Map` (not `Record<string, TourDefinition>`) because the id often comes from
 * an untrusted URL param: `.get()` is honestly typed `TourDefinition | undefined`,
 * so callers must handle an unknown id rather than assuming every lookup exists.
 */
export const TOURS_BY_ID: ReadonlyMap<string, TourDefinition> = new Map([
  [IMPORT_MEMBERS_TOUR_ID, importMembersTour],
  [CREATE_PERIOD_TOUR_ID, createPeriodTour],
  [SMART_IMPORT_TOUR_ID, smartImportTour],
]);
