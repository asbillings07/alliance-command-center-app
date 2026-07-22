"use client";

import { useState } from "react";
import { Button, type ButtonVariant, type ButtonSize } from "./Button";
import type { TourDefinition } from "@/app/src/lib/tours/types";
import { runTour } from "./tour/runTour";

export type TourButtonProps = {
  /** The tour to run when clicked. */
  tour: TourDefinition;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * Launches a contextual Driver.js tour.
 *
 * Driver.js is loaded lazily (via `runTour`) so it stays out of the initial
 * bundle and only downloads when a user actually asks for guidance. Tours are
 * described as plain data (see `@/app/src/lib/tours`) and run through the shared
 * `runTour` helper, so adding a new tour never touches Driver.js wiring.
 */
export function TourButton({
  tour,
  label = "Take a tour",
  variant = "secondary",
  size = "sm",
}: TourButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function startTour() {
    setIsLoading(true);
    try {
      await runTour(tour);
    } catch {
      // Tours are a non-critical enhancement. If the lazy Driver.js chunk fails
      // to load (offline / cache miss), swallow it rather than surfacing an
      // unhandled promise rejection — React does not await this onClick handler.
    } finally {
      // Only guards the async import; the tour then runs via its own overlay.
      setIsLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      loading={isLoading}
      onClick={startTour}
    >
      {label}
    </Button>
  );
}
