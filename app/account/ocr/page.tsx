import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { loadOcrConsent } from "@/app/src/lib/ocr/consent";
import { PageLayout, Card } from "@/app/src/components";
import { OcrSettings } from "./OcrSettings";

export const dynamic = "force-dynamic";
export default async function OcrSettingsPage() {
  const user = await requireAuth();
  const state = await loadOcrConsent(user.id).catch(() => null);
  return <main><PageLayout title="OCR Settings" description="Your account choices for screenshot processing and optional quality review."
    breadcrumb={[{ label: "Dashboard", href: "/app" }, { label: "Account", href: "/account" }, { label: "OCR Settings" }]} maxWidth="lg">
    {state ? <OcrSettings key={`${state.processing?.id ?? 0}:${state.quality?.id ?? 0}`} initial={state} />
      : <Card><h2 className="text-lg font-semibold">OCR Settings are unavailable</h2><p className="mt-3 text-text-secondary">Reload to check your preferences. No preference was changed.</p></Card>}
  </PageLayout></main>;
}
