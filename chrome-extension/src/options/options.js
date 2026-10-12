import { testConnection } from "../server/api.js";
import { defaultComputerName, loadSettings, originPattern, sanitizeSettings, saveSettings, validateSettings } from "../settings/settings.js";

const FIELDS = ["serverUrl", "token", "computerName", "tag", "visibility"];
const $ = (id) => document.getElementById(id);

function setStatus(message, kind = "") {
  $("status").textContent = message;
  $("status").className = `status ${kind}`.trim();
}

const readForm = () => sanitizeSettings(Object.fromEntries(FIELDS.map((key) => [key, $(key).value])));

/** Chrome only lets the extension call the server after the user grants that origin; this must run from a click. */
async function ensureServerAccess(settings) {
  const pattern = originPattern(settings.serverUrl);
  if (!pattern) return false;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return chrome.permissions.request({ origins: [pattern] });
}

async function init() {
  const settings = await loadSettings();
  for (const key of FIELDS) $(key).value = settings[key];
  if (!settings.computerName) {
    const platform = navigator.userAgentData?.platform ?? "";
    $("computerName").value = defaultComputerName(platform);
  }

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const next = readForm();
    const problems = validateSettings(next);
    if (problems.length > 0) return setStatus(problems[0], "error");
    if (!(await ensureServerAccess(next))) return setStatus("Permission to reach the server was not granted.", "error");
    await saveSettings(next);
    for (const key of FIELDS) $(key).value = next[key];
    setStatus("Settings saved.", "ok");
  });

  $("test").addEventListener("click", async () => {
    const next = readForm();
    const problems = validateSettings({ ...next, computerName: next.computerName || "x" });
    if (problems.length > 0) return setStatus(problems[0], "error");
    if (!(await ensureServerAccess(next))) return setStatus("Permission to reach the server was not granted.", "error");
    setStatus("Testing…");
    try {
      const username = await testConnection(next);
      setStatus(`Connected${username ? ` as ${username}` : ""}.`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

void init();
