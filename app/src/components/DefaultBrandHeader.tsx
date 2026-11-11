"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

/** The two authenticated shells supply their own controls. All other routes,
 * including new standalone/auth pages, receive the root's server-rendered header.
 * Read the matched layout segment, not a URL-prefix list of individual pages.
 */
export function DefaultBrandHeader({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return segment === "alliances" || segment === "platform" ? null : children;
}
