/** Turns a page into the markdown of a note. Pure, so it is easy to test. */

const pad = (n) => String(n).padStart(2, "0");

/** Local time as `2026-10-04 13:20`. */
export function formatSavedAt(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const escapeLinkText = (text) => text.replace(/\\/g, "\\\\").replace(/([[\]])/g, "\\$1").replace(/\s+/g, " ").trim();

const escapeUrl = (url) => url.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

/** True for pages a note can link to. */
export function isSavableUrl(url) {
  return /^https?:\/\//i.test(url ?? "");
}

/**
 * Note layout:
 *
 *   [Title](url)
 *
 *   > selected text        (only when text was selected)
 *
 *   your note              (only when you typed one)
 *
 *   Saved from **Computer** on 2026-10-04 13:20
 *   #web-clip              (when a tag is configured)
 */
export function buildMemoContent({ title, url, note = "", selection = "", savedAt, computerName, tag = "" }) {
  const linkText = escapeLinkText(title || "") || url;
  const blocks = [`[${linkText}](${escapeUrl(url)})`];

  const quote = selection.trim();
  if (quote) {
    blocks.push(
      quote
        .split(/\r?\n/)
        .map((line) => `> ${line}`.trimEnd())
        .join("\n"),
    );
  }
  const extra = note.trim();
  if (extra) blocks.push(extra);

  const footer = [`Saved from **${computerName}** on ${formatSavedAt(savedAt)}`];
  if (tag) footer.push(`#${tag}`);
  blocks.push(footer.join("\n"));

  return blocks.join("\n\n");
}
