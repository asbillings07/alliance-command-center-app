import type { TourDefinition } from "@/app/src/lib/tours/types";

export type RunTourOptions = {
  /** Called only when the user completes the tour (clicks Done on the last step). */
  onFinished?: () => void;
  /**
   * Cancels the run. If it aborts before the lazy Driver.js import resolves, no
   * Driver instance is created at all. This matters because Driver.js manages
   * global DOM: creating a second instance and destroying the first (e.g. React
   * StrictMode's mount -> unmount -> mount in dev) can race over that shared DOM
   * and leave the tour broken. Aborting first guarantees a single instance.
   */
  signal?: AbortSignal;
};

/**
 * Run a tour via Driver.js. Driver.js is imported lazily so it stays out of the
 * initial bundle and only downloads when a tour actually runs. Returns a handle
 * that tears the tour down (safe to call after it has already ended, and a no-op
 * if the run was aborted before it started).
 *
 * Completion is detected POSITIVELY: `onFinished` fires only when the user
 * clicks Done on the final step (`onDoneClick`). Every other way a tour ends -
 * the close (X) button, a backdrop click, Escape, a route change, or an explicit
 * teardown via the returned handle - leaves `completed` false, so an abandoned
 * tour is never mistaken for a completed one. (A negative "was it closed?" flag
 * would miss the backdrop/keyboard paths, which don't call `onCloseClick`.)
 *
 * Note: overriding `onDoneClick` disables Driver.js's default done behavior, so
 * the callback must call `destroy()` itself.
 */
export async function runTour(
  tour: TourDefinition,
  opts?: RunTourOptions
): Promise<() => void> {
  const { driver } = await import("driver.js");

  // The caller gave up while the import was in flight; never touch the DOM.
  if (opts?.signal?.aborted) {
    return () => {};
  }

  let completed = false;

  const driverObj = driver({
    showProgress: tour.steps.length > 1,
    allowClose: true,
    steps: tour.steps.map((step) => ({
      element: step.element,
      popover: {
        title: step.title,
        description: step.description,
      },
    })),
    onDoneClick: () => {
      completed = true;
      driverObj.destroy(); // required: overriding the hook disables the default
    },
    onDestroyed: () => {
      if (completed) {
        opts?.onFinished?.();
      }
    },
  });

  driverObj.drive();

  return () => driverObj.destroy();
}
