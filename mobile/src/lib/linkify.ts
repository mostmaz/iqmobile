// Splitting a message body into text and the links inside it.
//
// React Native renders a URL in a <Text> as inert characters. The admin can
// now send a shop the address of its panel, and a link the merchant has to
// retype by hand off a phone screen is barely a link at all.
//
// Deliberately conservative about what counts. This runs on message bodies
// written by other people, and a greedy matcher that swallows the Arabic
// full stop after a URL produces a link that 404s — worse than no link,
// because the merchant concludes the address is wrong.
//
// Dependency-free so `node --test` can import it.

/** A run of message text: either plain, or something to open. */
export type Segment = { text: string; url: string | null };

// http(s):// or a bare domain. Trailing punctuation is excluded by the
// character class rather than trimmed afterwards, so «الرابط: x.com، افتحه»
// does not produce "x.com،".
const URL_RE = /((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'،؛]*)?)/gi;

// A bare word with a dot is not a URL just because it has a dot in it.
// Without this, "iphone 13.pro" and any decimal in Latin script become links.
const PLAUSIBLE_TLD = /\.(com|org|net|iq|co|io|app|dev|me|tech|info|biz|tv|ly|gg)(\/|$|\?)/i;

/**
 * @returns the body split into segments, in order. A body with no links
 *   comes back as a single plain segment, so callers need no special case.
 */
export function linkify(body: string): Segment[] {
  const text = String(body ?? '');
  if (!text) return [{ text: '', url: null }];

  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const hasScheme = /^https?:\/\//i.test(raw);
    if (!hasScheme && !PLAUSIBLE_TLD.test(raw)) continue;

    if (start > last) out.push({ text: text.slice(last, start), url: null });
    out.push({ text: raw, url: hasScheme ? raw : `https://${raw}` });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), url: null });
  return out.length ? out : [{ text, url: null }];
}
