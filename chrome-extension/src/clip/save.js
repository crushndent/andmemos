import { createMemo } from "../server/api.js";
import { buildMemoContent, isSavableUrl } from "./memo.js";
import { validateSettings } from "../settings/settings.js";

/** Saves a page as a note; resolves to `{ memo, url }` where `url` opens the note on the server. */
export async function savePage({ settings, page, note = "", selection = "", now = new Date(), fetchImpl }) {
  const problems = validateSettings(settings);
  if (problems.length > 0) throw new Error(problems[0]);
  if (!isSavableUrl(page.url)) throw new Error("Only http and https pages can be saved.");

  const content = buildMemoContent({
    title: page.title,
    url: page.url,
    note,
    selection,
    savedAt: now,
    computerName: settings.computerName,
    tag: settings.tag,
  });
  const memo = await createMemo(settings, { content, visibility: settings.visibility }, fetchImpl);
  return { memo, url: `${settings.serverUrl}/${memo.name}` };
}
