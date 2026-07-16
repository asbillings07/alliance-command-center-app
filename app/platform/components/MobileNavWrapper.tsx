"use client";

import { useState } from "react";
import { PlatformNavMobile } from "./PlatformNav";

export function MobileNavWrapper() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(true)}
        className="lg:hidden p-1 text-text-muted hover:text-text-primary"
        aria-label="Open navigation menu"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* Mobile navigation drawer */}
      <PlatformNavMobile isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
