"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/app/src/components/client";

export function AccessRequestQueueRetryButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => router.refresh()}
      data-testid="access-request-queue-retry"
    >
      Retry
    </Button>
  );
}
