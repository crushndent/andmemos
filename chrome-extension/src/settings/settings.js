/** Settings live in chrome.storage.local (never sync) so each computer keeps its own name and server. */

export const DEFAULT_SETTINGS = Object.freeze({
  serverUrl: "",
  token: "",
  computerName: "",
  tag: "web-clip",
  visibility: "PRIVATE",
});

export const VISIBILITIES = ["PRIVATE", "PROTECTED", "PUBLIC"];

/** Accepts `host`, `host:port` or a full URL; returns an http(s) base URL without a trailing slash, or "" if unusable. */
export function normalizeServerUrl(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** The host permission pattern needed to talk to the server, e.g. `https://memos.example.com/*`. */
export function originPattern(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) return "";
  return `${new URL(normalized).origin}/*`;
}

/** A tag segment-safe name: no `#`, no spaces. Empty means "do not tag". */
export function normalizeTag(input) {
  return String(input ?? "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_\-/]/gu, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "");
}

/** A readable default such as "Windows computer"; the user is expected to replace it with a real name. */
export function defaultComputerName(platform) {
  const known = { Windows: "Windows", macOS: "Mac", Linux: "Linux", "Chrome OS": "Chromebook", ChromeOS: "Chromebook", Android: "Android" };
  const label = known[platform];
  return label ? `${label} computer` : "";
}

/** Merges stored values over the defaults, dropping anything of the wrong type. */
export function withDefaults(stored) {
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof stored?.[key] === "string") merged[key] = stored[key];
  }
  if (!VISIBILITIES.includes(merged.visibility)) merged.visibility = DEFAULT_SETTINGS.visibility;
  return merged;
}

/** Cleans user input into storable settings. */
export function sanitizeSettings(input) {
  const settings = withDefaults(input);
  return {
    serverUrl: normalizeServerUrl(settings.serverUrl),
    token: settings.token.trim(),
    computerName: settings.computerName.trim(),
    tag: normalizeTag(settings.tag),
    visibility: settings.visibility,
  };
}

/** What still has to be filled in before a page can be saved. */
export function validateSettings(settings) {
  const errors = [];
  if (!settings.serverUrl) errors.push("Enter your Memos server address.");
  if (!settings.token) errors.push("Paste an access token from Memos (Settings → My Account → Access Tokens).");
  if (!settings.computerName) errors.push("Give this computer a name so notes show where they were saved from.");
  return errors;
}

export async function loadSettings(storage = globalThis.chrome?.storage?.local) {
  const stored = await storage.get(Object.keys(DEFAULT_SETTINGS));
  return withDefaults(stored);
}

export async function saveSettings(input, storage = globalThis.chrome?.storage?.local) {
  const settings = sanitizeSettings(input);
  await storage.set(settings);
  return settings;
}
