"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Format in the viewer's locale and time zone only after hydration. */
export function LocalTimestamp({ value }: { value: string }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return <span>Time unavailable</span>;
  const label = hydrated ? new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(timestamp) : "Loading local time…";
  return <time dateTime={value} title={hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined}>{label}</time>;
}
