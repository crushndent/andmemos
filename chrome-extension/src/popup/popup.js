import { isSavableUrl } from "../clip/memo.js";
import { savePage } from "../clip/save.js";
import { loadSettings, validateSettings } from "../settings/settings.js";

const $ = (id) => document.getElementById(id);

function setStatus(message, kind = "") {
  const status = $("status");
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

async function init() {
  const settings = await loadSettings();
  const problems = validateSettings(settings);
  $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  if (problems.length > 0) {
    $("setup").hidden = false;
    $("setup-message").textContent = problems[0];
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSavableUrl(tab.url)) {
    setStatus("Only http and https pages can be saved.", "error");
    return;
  }

  $("form").hidden = false;
  $("title").value = tab.title ?? "";
  $("url").textContent = tab.url;
  $("url").title = tab.url;
  $("meta").textContent = `from ${settings.computerName}`;
  $("note").focus();

  const submit = async (event) => {
    event?.preventDefault();
    $("save").disabled = true;
    setStatus("Saving…");
    try {
      const { url } = await savePage({
        settings,
        page: { title: $("title").value, url: tab.url },
        note: $("note").value,
      });
      setStatus("Saved.", "ok");
      $("form").hidden = true;
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.textContent = "Open the note";
      $("status").append(" ", link);
    } catch (error) {
      setStatus(error.message, "error");
      $("save").disabled = false;
    }
  };

  $("form").addEventListener("submit", submit);
  $("note").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(event);
  });
}

void init();
