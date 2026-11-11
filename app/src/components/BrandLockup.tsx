import Image from "next/image";
import allianceIcon from "@/app/icon.png";

/** Product identity shared by public entry points and the alliance shell. */
export function BrandLockup({ compact = false }: { compact?: boolean }) {
  const size = compact ? 36 : 48;

  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <Image
        src={allianceIcon}
        alt=""
        width={size}
        height={size}
        priority={!compact}
        className="shrink-0 object-contain"
      />
      <span className={compact ? "hidden truncate sm:inline" : "min-w-0"}>
        <span className="block text-xl font-semibold leading-tight tracking-tight text-text-primary">
          Alliance
        </span>
        <span className="block text-[10px] font-medium uppercase leading-relaxed tracking-[0.18em] text-text-muted">
          Command Center
        </span>
      </span>
    </span>
  );
}
