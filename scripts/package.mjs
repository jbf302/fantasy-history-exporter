// Builds dist/fantasy-history-exporter-<version>.zip containing only the
// files the extension needs (no tests, fixtures, scripts or docs).
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const out = `dist/fantasy-history-exporter-${version}.zip`;
mkdirSync("dist", { recursive: true });
rmSync(out, { force: true });
execFileSync(
  "zip",
  ["-r", out, "manifest.json", "background.js", "assets", "content", "lib", "sidepanel", "LICENSE", "-x", "*.DS_Store"],
  { stdio: "inherit" }
);
console.log(`\nwrote ${out}`);
