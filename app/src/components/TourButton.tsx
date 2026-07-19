"use client";

import { useState } from "react";
import { Button, type ButtonVariant, type ButtonSize } from "./Button";
import type { TourDefinition } from "@/app/src/lib/tours/types";
import "driver.js/dist/driver.css";

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
 * Driver.js is loaded lazily on click so it stays out of the initial bundle and
 * only downloads when a user actually asks for guidance. Tours are described as
 * plain data (see `@/app/src/lib/tours`); this component is the sole client-side
 * runner, so adding a new tour never touches Driver.js wiring.
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
      const { driver } = await import("driver.js");
      const tourDriver = driver({
        showProgress: tour.steps.length > 1,
        allowClose: true,
        steps: tour.steps.map((step) => ({
          element: step.element,
          popover: {
            title: step.title,
            description: step.description,
          },
        })),
      });
      tourDriver.drive();
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
