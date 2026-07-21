"use client";

import { useEffect } from "react";
import type { GoogleConnectResult } from "@/app/src/lib/auth/googleConnection";
import { acknowledgeGoogleConnectResult } from "./actions";

type BannerCopy = { tone: "success" | "error"; message: string };

// Coarse, non-sensitive outcomes surfaced after the OAuth round trip. The
// server has already verified the signed result cookie; this only presents it.
const RESULT_COPY: Record<GoogleConnectResult, BannerCopy> = {
  connected: {
    tone: "success",
    message: "Google is now connected to your account.",
  },
  already_in_use: {
    tone: "error",
    message: "That Google account is already linked to a different account.",
  },
  intent_expired: {
    tone: "error",
    message: "Your connect request expired. Please try connecting again.",
  },
  unavailable: {
    tone: "error",
    message: "We couldn't connect Google just now. Please try again.",
  },
};

/**
 * Renders the read-once connect-result banner and clears the cookie on mount.
 *
 * The cookie is read during the server render (safe), but clearing it requires
 * an action/route handler — so acknowledgement happens here. If JS is disabled
 * the cookie simply expires on its own short TTL.
 */
export function GoogleConnectResultBanner({
  result,
}: {
  result: GoogleConnectResult;
}) {
  useEffect(() => {
    void acknowledgeGoogleConnectResult();
  }, []);

  const copy = RESULT_COPY[result];
  const classes =
    copy.tone === "success"
      ? "bg-success/10 border-success text-success"
      : "bg-danger/10 border-danger text-danger";

  return (
    <div className={`mb-4 rounded-md border p-3 text-sm ${classes}`} role="status">
      {copy.message}
    </div>
  );
}
