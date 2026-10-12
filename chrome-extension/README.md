# Memos Web Clipper (Chrome extension)

Saves the current page, a link or a selection as a note on your own Memos server.
This is a **separate project** that lives in this repository for context only: it shares no code
with the Go server or the web app, has its own `package.json`, and is not built or tested by their CI.
It talks to the server only through the public API (`POST /api/v1/memos`, `GET /api/v1/auth/me`).

## Layout

| Path | Holds |
| --- | --- |
| `manifest.json` | Manifest V3 definition: permissions, popup, options page, background worker, shortcut |
| `src/background/` | Service worker: right-click menu and keyboard shortcut, toolbar badge feedback |
| `src/popup/` | The toolbar popup (edit the title, add a note, save) |
| `src/options/` | The options page (server, token, computer name, tag, visibility) |
| `src/clip/` | Turning a page into note markdown (`memo.js`) and saving it (`save.js`) |
| `src/server/` | The Memos API client |
| `src/settings/` | Settings: defaults, cleaning, validation, `chrome.storage.local` access |
| `src/styles/` | Stylesheet shared by the popup and options page |
| `icons/` | Toolbar and store icons |
| `test/` | Tests, mirroring `src/` (`node --test`, no dependencies) |

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** and choose this `chrome-extension/` folder.
3. The options page opens: enter your server address, paste an access token
   (Memos → Settings → My Account → Access Tokens), and name this computer.
4. **Test connection**, then **Save settings**. Chrome asks once to allow access to your server's address.

## Using it

- **Toolbar button:** edit the title, add an optional note, Save (Ctrl/Cmd+Enter in the note box also saves).
- **Right-click** a page, link or selected text → **Save to Memos**. The toolbar icon shows ✓ or !.
- **Alt+Shift+M** saves the current tab immediately (change it at `chrome://extensions/shortcuts`).

A saved note looks like this, and the server stamps its own creation time as usual:

```
[Page title](https://example.com/page)

> selected text (only if you selected some)

your note (only if you typed one)

Saved from **Work laptop** on 2026-10-04 13:05
#web-clip
```

## Settings and privacy

- Settings are stored with `chrome.storage.local`, never `sync`, so each computer keeps its own
  name and credentials. The token stays in this browser profile.
- The computer name cannot be read from the browser, so you set it yourself on each computer.
- The extension asks for no standing access to websites. It requests permission for your server's
  address only, when you save the options, and uses `activeTab` for the page you are saving.

## Tests

```bash
cd chrome-extension && npm test   # Node 20+; no install step
```
