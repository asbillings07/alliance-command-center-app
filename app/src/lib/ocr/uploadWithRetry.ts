// Only a fresh, explicit service outage from the server can schedule a retry.
// A lost response, history read or replay of the original POST never does.
export async function uploadWithRetry(endpoint: string, form: FormData, options: {
  onRetry: () => void;
  cancelled: () => boolean;
  signal?: AbortSignal;
}) {
  const post = () => fetch(endpoint, { method: "POST", body: form, signal: options.signal });
  const first = await post();
  const attempt = await first.json();
  if (!first.ok) throw Object.assign(new Error(attempt.error || "The scan did not complete."), { outcome: attempt.outcome });
  if (attempt.retryOnce !== true || form.has("retryOf") || options.cancelled()) return attempt;

  options.onRetry();
  await new Promise(resolve => setTimeout(resolve, 2000));
  if (options.cancelled()) return attempt;
  form.set("retryOf", attempt.id);
  form.set("automaticRetry", "1");
  form.set("requestId", crypto.randomUUID());
  const retry = await post();
  const result = await retry.json();
  if (!retry.ok) throw Object.assign(new Error(result.error || "The retry did not complete."), { outcome: result.outcome });
  return result;
}
