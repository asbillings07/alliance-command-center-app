import { Button } from "./client";

export function CaptureMethodLinks({ allianceId, periodId, selected }: {
  allianceId: string;
  periodId?: string;
  selected: "screenshots" | "spreadsheet" | "manual";
}) {
  const alliance = `/alliances/${allianceId}`;
  const base = periodId ? `${alliance}/periods/${periodId}/import` : `${alliance}/setup/import`;
  const screenshots = periodId ? `${base}?method=screenshots` : `${alliance}/screenshots?scope=batch`;
  return <nav aria-label="Add results" className="mb-6 flex flex-wrap gap-3">
    <Button variant={selected === "screenshots" ? "primary" : "secondary"} href={screenshots}>Screenshots</Button>
    <Button variant={selected === "spreadsheet" ? "primary" : "secondary"} href={`${base}?method=spreadsheet`}>Spreadsheet</Button>
    <Button variant={selected === "manual" ? "primary" : "secondary"} href={periodId ? `${alliance}/periods/${periodId}/record` : `${base}?method=manual`}>Manual entry</Button>
  </nav>;
}
