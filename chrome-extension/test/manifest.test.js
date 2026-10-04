import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe("manifest", () => {
  it("is Manifest V3 with a module service worker", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.background.type, "module");
  });

  it("points only at files that exist", () => {
    const referenced = [
      manifest.action.default_popup,
      manifest.options_ui.page,
      manifest.background.service_worker,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
    ];
    for (const file of referenced) assert.ok(existsSync(join(root, file)), file);
  });

  it("asks for as little as it can: no standing host access, no broad permissions", () => {
    assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "contextMenus", "storage"]);
    assert.equal(manifest.host_permissions, undefined);
    assert.ok(manifest.optional_host_permissions.length > 0);
  });

  it("declares the keyboard shortcut the background script handles", () => {
    assert.ok(manifest.commands["save-page"]);
  });
});

describe("source layout", () => {
  const sources = walk(join(root, "src")).filter((file) => file.endsWith(".js"));

  it("only imports files inside the extension that exist", () => {
    for (const file of sources) {
      for (const [, specifier] of readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)) {
        assert.ok(specifier.startsWith("."), `${file}: ${specifier} must be a relative import`);
        const target = resolve(dirname(file), specifier);
        assert.ok(existsSync(target), `${file}: ${specifier} does not exist`);
        assert.ok(target.startsWith(root), `${file}: ${specifier} leaves the extension`);
      }
    }
  });

  it("keeps the HTML pages' stylesheet and script references valid", () => {
    for (const file of walk(join(root, "src")).filter((f) => f.endsWith(".html"))) {
      for (const [, ref] of readFileSync(file, "utf8").matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)) {
        assert.ok(existsSync(resolve(dirname(file), ref)), `${file}: ${ref}`);
      }
    }
  });
});
