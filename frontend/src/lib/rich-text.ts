/**
 * Sanitizer for the small formatting set `RichTextEditor` produces (bold,
 * italic, underline, lists, links).
 *
 * This is the actual security boundary, not the editor: the HTML is stored
 * and can be replayed by anyone hitting the API directly, so it is run again
 * here at render time rather than trusted because "the editor wrote it".
 *
 * Deliberately hand-rolled rather than a `DOMPurify` dependency — the allowed
 * set is tiny and fixed (see ALLOWED_TAGS), and the project has no HTML
 * sanitizer anywhere else to lean on.
 */

const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'UL',
  'OL',
  'LI',
  'A',
  'BR',
  'P',
  'DIV',
  'SPAN',
]);

/** Tags whose entire subtree must be dropped, not unwrapped. */
const DROP_ENTIRELY = new Set(['SCRIPT', 'STYLE']);

const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:'];

function isSafeHref(href: string): boolean {
  try {
    // A base is required for relative-looking strings; anything that isn't
    // absolute after that is rejected rather than guessed at.
    const url = new URL(href, 'https://example.invalid');
    return SAFE_URL_SCHEMES.includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeNode(node: Node, out: Node[], doc: Document): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.cloneNode());
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  if (DROP_ENTIRELY.has(el.tagName)) return;

  const children: Node[] = [];
  for (const child of Array.from(el.childNodes)) {
    sanitizeNode(child, children, doc);
  }

  if (!ALLOWED_TAGS.has(el.tagName)) {
    // Unwrap: keep the text/inline content, drop the tag itself.
    out.push(...children);
    return;
  }

  const clean = doc.createElement(el.tagName.toLowerCase());
  if (el.tagName === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (isSafeHref(href)) {
      clean.setAttribute('href', href);
      clean.setAttribute('target', '_blank');
      clean.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const child of children) clean.appendChild(child);
  out.push(clean);
}

/** Returns sanitized HTML, safe to pass to `dangerouslySetInnerHTML`. */
export function sanitizeRichText(html: string): string {
  if (!html || typeof window === 'undefined') return '';

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const out: Node[] = [];
  for (const child of Array.from(parsed.body.childNodes)) {
    sanitizeNode(child, out, parsed);
  }

  const container = parsed.createElement('div');
  for (const node of out) container.appendChild(node);
  return container.innerHTML;
}

/** Whether sanitized rich text is empty of any real content (worth hiding). */
export function isRichTextEmpty(html: string | undefined | null): boolean {
  if (!html) return true;
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return text.length === 0;
}

/**
 * One-line plain-text preview of rich text, for table cells and cards where
 * rendering actual bullets/bold would break the layout. Regex-based rather
 * than `DOMParser` so it also works during server rendering.
 */
export function richTextToPlainText(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
