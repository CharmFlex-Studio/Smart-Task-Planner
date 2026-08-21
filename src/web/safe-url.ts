/**
 * The one place that decides whether a URL out of a task file may be followed.
 *
 * One place on purpose: the reading view and the editor both hand URLs to the browser,
 * and two validators that drift apart is how a `javascript:` link ends up clickable in
 * one of them. Task files come from shared folders, synced drives and models, so a link
 * in one is not necessarily something the reader wrote.
 */

/** The URL to use, or null when it must not be followed. */
export function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (/^(https?:|mailto:)/i.test(url)) return url;
  // A scheme we did not allow — javascript:, data:, file: — is refused outright.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  // No scheme at all: a relative link inside the vault, which is fine.
  return url;
}

/** Only follow a link in a new tab, and never let it reach back at the opener. */
export function openExternally(url: string): void {
  const safe = safeUrl(url);
  if (!safe) return;
  window.open(safe, '_blank', 'noopener,noreferrer');
}
