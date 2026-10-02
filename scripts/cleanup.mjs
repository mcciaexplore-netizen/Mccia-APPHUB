#!/usr/bin/env node
/**
 * Scans the project for things nothing uses and (only when asked) removes them.
 *
 *   npm run clean:scan                 report only, changes nothing
 *   npm run clean:fix                  remove unused exports and unused dependencies
 *   node scripts/cleanup.mjs --fix --files     also delete unused source files
 *   node scripts/cleanup.mjs --caches          also delete build caches (.next dev cache, tsbuildinfo)
 *
 * Safety: --fix refuses to run on a dirty git tree (so every change can be undone with `git restore .`), and after
 * changing anything it re-runs typecheck, lint and the build. If any of them fail, the changes are reverted.
 * Unused CSS classes and public/ files are only reported, never removed: they can be referenced in ways a scan cannot see.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const FIX = args.has("--fix");
const FILES = args.has("--files");
const CACHES = args.has("--caches");
const FORCE = args.has("--force");
const ROOT = process.cwd();
const bin = (n) => join(ROOT, "node_modules", ".bin", n);

const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { cwd: ROOT, encoding: "utf8", ...opts });
const h = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const ok = (t) => console.log(`  \x1b[32m✓\x1b[0m ${t}`);
const bad = (t) => console.log(`  \x1b[31m✗\x1b[0m ${t}`);
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function size(p) {
  if (!existsSync(p)) return 0;
  const s = statSync(p);
  return s.isDirectory() ? walk(p).reduce((n, f) => n + statSync(f).size, 0) : s.size;
}

// ---- checks ---------------------------------------------------------------------------------------------------
function knip() {
  const r = run(bin("knip"), ["--no-progress"]);
  const out = `${r.stdout}${r.stderr}`.split("\n").filter((l) => !/injected env|EBADENGINE|^$/.test(l)).join("\n").trim();
  return { clean: r.status === 0 && out === "", out };
}
function typecheck() {
  const r = run(bin("tsc"), ["--noEmit"]);
  return { clean: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
}
function lint() {
  const r = run(bin("eslint"), ["src", "scripts", "--format", "json"]);
  let errors = 0, warnings = 0; const lines = [];
  try {
    for (const f of JSON.parse(r.stdout)) {
      errors += f.errorCount; warnings += f.warningCount;
      for (const m of f.messages) lines.push(`${f.filePath.replace(ROOT + "/", "")}:${m.line}  ${m.ruleId ?? ""}  ${m.message}`);
    }
  } catch { return { clean: false, errors: 1, warnings: 0, lines: [`${r.stdout}${r.stderr}`.slice(0, 500)] }; }
  return { clean: errors === 0 && warnings === 0, errors, warnings, lines };
}
function unusedCssClasses() {
  const css = join(ROOT, "src/app/globals.css");
  if (!existsSync(css)) return [];
  const classes = [...new Set([...readFileSync(css, "utf8").matchAll(/^\s*\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1]))];
  const code = walk(join(ROOT, "src")).filter((f) => /\.(tsx?|jsx?)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  return classes.filter((c) => !code.includes(c));
}
function unusedPublicFiles() {
  const code = walk(join(ROOT, "src")).filter((f) => /\.(tsx?|jsx?|css)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  return walk(join(ROOT, "public")).map((f) => f.replace(join(ROOT, "public"), "")).filter((f) => !code.includes(f) && !code.includes(f.split("/").pop()));
}
const CACHE_TARGETS = [".next/dev", ".next.nosync/dev", "tsconfig.tsbuildinfo"];

// ---- scan -----------------------------------------------------------------------------------------------------
function scan() {
  h("1. Unused files, exports, types and dependencies (knip)");
  const k = knip();
  if (k.clean) ok("nothing unused");
  else { bad("found:"); console.log(k.out.split("\n").map((l) => "    " + l).join("\n")); }

  h("2. Type errors");
  const t = typecheck();
  if (t.clean) ok("none");
  else { bad("type errors:"); console.log(t.out.split("\n").slice(0, 15).map((l) => "    " + l).join("\n")); }

  h("3. Lint errors and warnings (unused variables and imports show up here)");
  const l = lint();
  if (l.clean) ok("none");
  else { bad(`${l.errors} errors, ${l.warnings} warnings:`); console.log(l.lines.slice(0, 20).map((x) => "    " + x).join("\n")); }

  h("4. Unused CSS classes in src/app/globals.css (report only)");
  const css = unusedCssClasses();
  if (css.length) { bad(css.map((c) => "." + c).join("  ")); console.log("    Check before deleting: a class can be built from a string."); }
  else ok("none");

  h("5. public/ files nothing references (report only)");
  const pub = unusedPublicFiles();
  if (pub.length) bad(pub.join("  "));
  else ok("none");

  h("6. Build caches that only waste space");
  const caches = CACHE_TARGETS.filter((c) => existsSync(join(ROOT, c)));
  if (caches.length) for (const c of caches) bad(`${c}  ${kb(size(join(ROOT, c)))}`);
  else ok("none");
  console.log("    Remove with: node scripts/cleanup.mjs --caches");

  return { k, t, l };
}

// ---- main -----------------------------------------------------------------------------------------------------
console.log("MCCIA App Hub cleanup" + (FIX ? "  (FIX mode)" : "  (scan only, nothing is changed)"));
const before = scan();

if (CACHES) {
  h("Removing build caches");
  for (const c of CACHE_TARGETS) if (existsSync(join(ROOT, c))) { const s = size(join(ROOT, c)); rmSync(join(ROOT, c), { recursive: true, force: true }); ok(`removed ${c} (${kb(s)})`); }
}

if (!FIX) {
  console.log("\nTo remove unused exports and dependencies: npm run clean:fix   (add --files to delete unused files too)\n");
  process.exit(before.k.clean && before.t.clean && before.l.clean ? 0 : 1);
}

h("Applying fixes");
const dirty = run("git", ["status", "--porcelain"]).stdout.trim();
if (dirty && !FORCE) {
  bad("The git working tree has uncommitted changes. Commit or stash them first, so everything this script does can be undone.");
  console.log(dirty.split("\n").slice(0, 10).map((l) => "    " + l).join("\n") + "\n    (use --force to run anyway, without the automatic undo)");
  process.exit(2);
}
if (before.k.clean) { ok("knip found nothing to fix"); process.exit(0); }

const fixArgs = ["--no-progress", "--fix", "--fix-type", "exports,types,dependencies"];
if (FILES) fixArgs.push("--allow-remove-files");
run(bin("knip"), fixArgs);
const changed = run("git", ["status", "--porcelain"]).stdout.trim();
if (!changed) { ok("knip changed nothing (the remaining items need a manual decision)"); process.exit(0); }
console.log(changed.split("\n").map((l) => "    " + l).join("\n"));

h("Verifying the project still works");
const checks = [
  ["typecheck", () => typecheck().clean],
  ["lint", () => lint().errors === 0],
  ["build", () => run("npm", ["run", "build"]).status === 0],
];
let failed = null;
for (const [name, fn] of checks) { if (fn()) ok(name); else { bad(name); failed = name; break; } }
if (failed) {
  if (dirty) { bad(`${failed} failed. Changes were NOT reverted (you used --force). Undo with: git restore .`); process.exit(3); }
  run("git", ["restore", "--staged", "--worktree", "."]);
  bad(`${failed} failed, so every change was reverted. Nothing was removed.`);
  process.exit(3);
}
ok("everything passes. Review with `git diff`, then commit (or undo with `git restore .`).");
