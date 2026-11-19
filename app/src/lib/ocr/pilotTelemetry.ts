// During the pilot only ordinary page reads may reach server error monitoring.
// An unclassified event or mutation can contain request data or Next action
// arguments. Suppress it, including the entire associated trace.
export function allowPilotServerEvent(event: { request?: { method?: string; url?: string } }) {
  if (process.env.VERCEL_ENV !== "production" || process.env.OCR_PILOT_ENABLED !== "true") return true;
  if (event.request?.method !== "GET" || !event.request.url) return false;
  try {
    const path = decodeURIComponent(new URL(event.request.url).pathname).toLowerCase();
    return !/(?:^|\/)(?:ocr[^/]*|screenshots?|import|members|history)(?:\/|$)/.test(path);
  } catch { return false; }
}
