#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function parseArguments(args, { verification = false } = {}) {
  const options = { base: 'origin/main', json: false, run: false, plan: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json')
      options.json = true;
    else if (arg === '--help')
      options.help = true;
    else if (arg === '--base' && args[i + 1] && !args[i + 1].startsWith('-'))
      options.base = args[++i];
    else if (verification && arg === '--run')
      options.run = true;
    else if (verification && arg === '--plan')
      options.plan = true;
    else
      throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (options.run && options.plan)
    throw new Error('Use either --plan or --run, not both.');
  if (options.run && options.json)
    throw new Error('--json describes a plan; use --plan --json or --run.');
  return options;
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function nulPaths(value) { return value.split('\0').filter(Boolean); }
function matches(path, pattern) {
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        i++;
        regex += '(?:.*/)?';
      }
      else
        regex += '.*';
    }
    else if (char === '*')
      regex += '[^/]*';
    else if (char === '?')
      regex += '[^/]';
    else
      regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$', 'u').test(path);
}
function dirtyFiles(root) {
  const parts = nulPaths(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2);
    const file = { status, path: parts[i].slice(3) };
    if (/[RC]/u.test(status))
      file.originalPath = parts[++i];
    files.push(file);
  }
  return files;
}
function readJson(root, path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  }
  catch {
    throw new Error(`Cannot read valid JSON from ${path}.`);
  }
}
export function collectStatus({ base = 'origin/main', cwd = process.cwd() } = {}) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const commit = (ref) => {
    try {
      return git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
    }
    catch {
      throw new Error(`Cannot resolve ${ref}; fetch origin/main explicitly before planning.`);
    }
  };
  const head = commit('HEAD');
  const originMain = commit('origin/main');
  const baseCommit = commit(base);
  const mergeBase = git(root, ['merge-base', baseCommit, head]).trim();
  const [behind, ahead] = git(root, ['rev-list', '--left-right', '--count', `${originMain}...${head}`]).trim().split(/\s+/u).map(Number);
  const files = dirtyFiles(root);
  const changedFiles = [...new Set([
      ...nulPaths(git(root, ['diff', '--name-only', '--no-renames', '-z', mergeBase, head])),
      ...nulPaths(git(root, ['diff', '--name-only', '--no-renames', '-z'])),
      ...nulPaths(git(root, ['diff', '--cached', '--name-only', '--no-renames', '-z'])),
      ...nulPaths(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
    ])].sort();
  const map = readJson(root, '.agent/domain-map.json');
  if (map.version !== 1 || !Array.isArray(map.surfaces) || !map.gates)
    throw new Error('Unsupported or invalid domain map.');
  const surfaces = map.surfaces.filter(surface => changedFiles.some(path => surface.paths.some(pattern => matches(path, pattern)) && !(surface.exclude_paths ?? []).some(pattern => matches(path, pattern))));
  const unmappedFiles = changedFiles.filter(path => !map.surfaces.some(surface => surface.paths.some(pattern => matches(path, pattern)) && !(surface.exclude_paths ?? []).some(pattern => matches(path, pattern))));
  const gateIds = changedFiles.length ? [...(map.common_verification ?? []), ...surfaces.flatMap(surface => surface.verification)] : [];
  for (const extra of map.additional_verification ?? []) {
    if (changedFiles.some(path => extra.paths.some(pattern => matches(path, pattern))))
      gateIds.push(...extra.gates);
  }
  const manualDatabaseVerification = (map.manual_database_verification ?? [])
    .filter(item => changedFiles.some(path => item.paths.some(pattern => matches(path, pattern))))
    .map(({ paths, ...item }) => item);
  const uniqueCommands = new Set();
  const recommendedVerification = [];
  for (const id of gateIds) {
    const gate = map.gates[id];
    if (!gate || !Array.isArray(gate.command) || !gate.command.length || gate.command.some(arg => typeof arg !== 'string'))
      throw new Error(`Invalid verification gate: ${id}`);
    const directory = gate.cwd ?? '.';
    if (directory.startsWith('/') || directory.split('/').includes('..'))
      throw new Error(`Gate ${id} must stay inside the repository.`);
    const command = gate.command.map(arg => arg === "{mergeBase}" ? mergeBase : arg);
    const key = JSON.stringify([directory, command]);
    if (uniqueCommands.has(key))
      continue;
    uniqueCommands.add(key);
    recommendedVerification.push({ id, ...gate, command, cwd: directory });
  }
  const journal = readJson(root, 'drizzle/meta/_journal.json');
  if (!Array.isArray(journal.entries))
    throw new Error('Invalid migration journal entries.');
  const pnpm = spawnSync('pnpm', ['--manage-package-manager-versions=false', '--version'], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  return {
    root, branch: git(root, ['branch', '--show-current']).trim() || '(detached HEAD)', head, originMain,
    base, mergeBase, ahead, behind, dirtyFiles: files, changedFiles,
    migrationJournalHead: journal.entries.at(-1) ?? null,
    nodeVersion: process.version, pnpmVersion: pnpm.status === 0 ? pnpm.stdout.trim() : 'unavailable',
    nodeRequirements: map.node_versions ?? {},
    changedSurfaces: surfaces.map(surface => surface.id), surfaces,
    conflictHotspots: (map.conflict_hotspots ?? []).filter(path => changedFiles.some(file => matches(file, path))),
    unmappedFiles, recommendedVerification, manualDatabaseVerification,
    macDaemonFreshRequired: surfaces.some(surface => surface.local_refresh.mac_daemon),
    iosRebuildRequired: surfaces.some(surface => surface.local_refresh.ios_rebuild),
    productionAcceptanceRequired: surfaces.some(surface => surface.production_acceptance.required),
  };
}
export function displayCommand(gate) {
  const quote = value => /^[a-zA-Z0-9_./:@=+-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  const command = gate.command.map(quote).join(' ');
  return gate.cwd === '.' ? command : `(cd ${quote(gate.cwd)} && ${command})`;
}
export function printStatus(status) {
  console.log(`Branch: ${status.branch}\nHEAD: ${status.head}\norigin/main: ${status.originMain}\nAhead / behind origin/main: ${status.ahead} / ${status.behind}`);
  console.log(`Diff base: ${status.base} (merge-base ${status.mergeBase}) + index/worktree/untracked`);
  console.log(`Dirty files (${status.dirtyFiles.length}):`);
  for (const file of status.dirtyFiles)
    console.log(`  ${file.status} ${JSON.stringify(file.path)}${file.originalPath ? ' <- ' + JSON.stringify(file.originalPath) : ''}`);
  console.log(`Migration journal head: ${status.migrationJournalHead?.tag ?? 'none'} (idx ${status.migrationJournalHead?.idx ?? 'none'})`);
  console.log(`Node / pnpm: ${status.nodeVersion} / ${status.pnpmVersion}`);
  console.log('Runtime Node: Railway/server 22; Mac preferred 22; Web 24; Claude bridge >=20; CI 24.');
  console.log(`Changed surfaces: ${status.changedSurfaces.join(', ') || 'none'}`);
  console.log(`Conflict hotspots: ${status.conflictHotspots.join(', ') || 'none'}`);
  console.log('Recommended verification:');
  for (const gate of status.recommendedVerification)
    console.log(`  ${displayCommand(gate)}${gate.node_major ? ` [Node ${gate.node_major}]` : ''}`);
  for (const item of status.manualDatabaseVerification)
    console.log(`  MANUAL DATABASE: ${displayCommand(item)}; flags ${Object.entries(item.environment).map(([key, value]) => `${key}=${value}`).join(" ")}. ${item.instructions}`);
  console.log(`Mac daemon fresh required? ${status.macDaemonFreshRequired ? 'YES' : 'NO'}`);
  console.log(`iOS rebuild required? ${status.iosRebuildRequired ? 'YES' : 'NO'}`);
  console.log(`Production acceptance required? ${status.productionAcceptanceRequired ? 'YES' : 'NO'}`);
  for (const surface of status.surfaces)
    console.log(`  ${surface.id} (${surface.runtime_locations.join('/')}): ${surface.local_refresh.instructions}\n    Acceptance: ${surface.production_acceptance.instructions}`);
  if (status.unmappedFiles.length)
    console.log(`UNMAPPED: ${status.unmappedFiles.map(path => JSON.stringify(path)).join(', ')}. Review manually; the plan is incomplete.`);
  console.log('Planning reads local Git refs only. Merge does not prove production is live.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help)
      console.log('Usage: pnpm agent:status [--json] [--base origin/main]');
    else {
      const status = collectStatus(options);
      if (options.json)
        console.log(JSON.stringify(status, null, 2));
      else
        printStatus(status);
    }
  }
  catch (error) {
    console.error(`[agent:status] ${error.message}`);
    process.exitCode = 1;
  }
}
