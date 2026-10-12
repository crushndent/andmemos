import { isSavableUrl } from "../clip/memo.js";
import { savePage } from "../clip/save.js";
import { loadSettings, validateSettings } from "../settings/settings.js";

const MENU_ID = "save-to-memos";
const BADGE_CLEAR_MS = 4000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Save to Memos",
    contexts: ["page", "link", "selection"],
  });
});

function flash(tabId, text, color, title) {
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setTitle({ title, tabId });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", tabId });
    chrome.action.setTitle({ title: "Save to Memos", tabId });
  }, BADGE_CLEAR_MS);
}

/** Saves without opening the popup (right-click menu and keyboard shortcut) and reports on the toolbar badge. */
async function saveQuickly({ tabId, title, url, selection = "" }) {
  try {
    const settings = await loadSettings();
    if (validateSettings(settings).length > 0) {
      await chrome.runtime.openOptionsPage();
      return;
    }
    await savePage({ settings, page: { title, url }, selection });
    flash(tabId, "✓", "#1a7f37", "Saved to Memos");
  } catch (error) {
    flash(tabId, "!", "#cf222e", `Not saved: ${error.message}`);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const link = info.linkUrl;
  const url = link || info.pageUrl || tab?.url;
  if (!isSavableUrl(url)) return;
  // A right-clicked link has no known title: its visible text is the best name we are given.
  const title = link ? info.selectionText || link : tab?.title || url;
  void saveQuickly({ tabId: tab?.id, title, url, selection: link ? "" : (info.selectionText ?? "") });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSavableUrl(tab.url)) return;
  void saveQuickly({ tabId: tab.id, title: tab.title ?? tab.url, url: tab.url });
});
