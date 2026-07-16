import { redirect } from "next/navigation";

/**
 * Platform root redirects to /platform/overview.
 *
 * The Platform Operations Console is organized by workflows,
 * not data entities. The landing page is Overview.
 */
export default function PlatformPage() {
  redirect("/platform/overview");
}
