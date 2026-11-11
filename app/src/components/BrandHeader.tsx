import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLockup } from "./BrandLockup";
import { ReleaseStageBadge } from "./ReleaseStageBadge";

/** Identity and release context shared by every page shell. */
export function BrandHeader({
  href = "/",
  publicPage = false,
  actions,
  tools,
}: {
  href?: string;
  publicPage?: boolean;
  actions?: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <header data-testid="brand-header" className={`brand-header sticky top-0 ${publicPage ? "z-30 bg-background" : "z-50 bg-brand-surface"} border-b border-border`}>
      {!publicPage && <div aria-hidden="true" className="brand-rule" />}
      <div className={`brand-header-grid ${publicPage ? "brand-header-public mx-auto max-w-6xl" : ""} ${tools ? "brand-header-with-tools" : ""}`}>
        <Link href={href} aria-label="Alliance Command Center home" className="brand-header-home min-w-0 justify-self-start rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <BrandLockup compact={!publicPage} />
        </Link>
        <ReleaseStageBadge />
        {actions && <div data-testid="brand-header-actions" className="brand-header-actions">{actions}</div>}
        {tools && <div className="brand-header-tools">{tools}</div>}
      </div>
    </header>
  );
}
