"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/app/src/components/client";

export function FeedbackInboxRetryButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => router.refresh()}
      data-testid="feedback-inbox-retry"
    >
      Retry
    </Button>
  );
}
