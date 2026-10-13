#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const clean = args.has("--clean");
const check = clean || args.has("--check") || args.size === 0;

if (!check) {
  console.error("usage: node scripts/local-hygiene.mjs [--check|--clean]");
  process.exit(2);
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const root = resolve(git(["rev-parse", "--show-toplevel"]));
const normalizedRoot = root.replaceAll("\\", "/");

const syncedLocationMarkers = [
  "/Documents/",
  "/Desktop/",
  "/Library/Mobile Documents/",
  "/Library/CloudStorage/",
];

const locationViolations =
  process.env.CI
    ? []
    : syncedLocationMarkers.filter((marker) => normalizedRoot.includes(marker));

if (locationViolations.length > 0) {
  console.error(
    `hygiene: refusing a sync-provider-backed working copy: ${root}`,
  );
  console.error(
    "Use ~/Developer/leilei-os-main or a disposable local worktree.",
  );
  process.exit(1);
}

const disposableDirectoryNames = new Set([
  ".derivedData",
  ".pnpm-store",
  ".turbo",
  ".vite",
  ".worktrees",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
  "xcuserdata",
]);

const ignoredTraversalNames = new Set([
  ".git",
  "node_modules",
]);

function isDisposableFile(path) {
  const name = basename(path);
  return name === ".DS_Store" || name.endsWith(".tsbuildinfo");
}

function tracked(path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..")) {
    return false;
  }

  const output = git(["ls-files", "--", rel]);
  return output.length > 0;
}

function collectResidue(directory, residue) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (ignoredTraversalNames.has(entry.name)) {
      continue;
    }

    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      if (disposableDirectoryNames.has(entry.name)) {
        if (!tracked(path)) {
          residue.push(path);
        }
        continue;
      }

      collectResidue(path, residue);
      continue;
    }

    if (stat.isFile() && isDisposableFile(path) && !tracked(path)) {
      residue.push(path);
    }
  }
}

function findResidue() {
  const residue = [];
  collectResidue(root, residue);
  return residue.sort();
}

let residue = findResidue();

if (clean && residue.length > 0) {
  for (const path of residue) {
    rmSync(path, { recursive: true, force: true });
    console.log(`removed ${relative(root, path)}`);
  }
  residue = findResidue();
}

if (residue.length > 0) {
  console.error("hygiene: disposable residue remains:");
  for (const path of residue) {
    console.error(`- ${relative(root, path)}`);
  }
  process.exit(1);
}

console.log(`hygiene: clean (${root})`);
