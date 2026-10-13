#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { collectStatus, displayCommand, parseArguments } from './agent-status.mjs';
try {
  const options = parseArguments(process.argv.slice(2), { verification: true });
  if (options.help) {
    console.log('Usage: pnpm agent:verify [--plan | --run] [--json] [--base origin/main]\nDefault: plan only. No migration, refresh, deployment or production acceptance is executed.');
  }
  else {
    const status = collectStatus(options);
    const plan = {
      base: status.base, head: status.head, mergeBase: status.mergeBase,
      changedFiles: status.changedFiles, changedSurfaces: status.changedSurfaces,
      gates: status.recommendedVerification, manualDatabaseVerification: status.manualDatabaseVerification, unmappedFiles: status.unmappedFiles,
      conflictHotspots: status.conflictHotspots, nodeRequirements: status.nodeRequirements,
      macDaemonFreshRequired: status.macDaemonFreshRequired,
      iosRebuildRequired: status.iosRebuildRequired,
      productionAcceptanceRequired: status.productionAcceptanceRequired,
      manualRequirements: status.surfaces.map(surface => ({ surface: surface.id, localRefresh: surface.local_refresh.instructions, productionAcceptance: surface.production_acceptance.instructions })),
    };
    if (options.json)
      console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(`Verification ${options.run ? 'run' : 'plan'}: ${plan.changedSurfaces.join(', ') || 'no changed surfaces'}`);
      for (const gate of plan.gates)
        console.log(`  ${gate.id}: ${displayCommand(gate)}${gate.node_major ? ` [Node ${gate.node_major}]` : ''}`);
      for (const item of plan.manualDatabaseVerification)
        console.log(`  MANUAL DATABASE: ${displayCommand(item)}; flags ${Object.entries(item.environment).map(([key, value]) => `${key}=${value}`).join(" ")}. ${item.instructions}`);
      for (const item of plan.manualRequirements)
        console.log(`  ${item.surface}: ${item.localRefresh}\n    Acceptance: ${item.productionAcceptance}`);
      if (plan.unmappedFiles.length)
        console.log(`UNMAPPED: ${plan.unmappedFiles.map(path => JSON.stringify(path)).join(', ')}. Manually extend the verification scope.`);
      console.log('Local gates only; refresh, migration and production acceptance remain explicit actions.');
    }
    if (options.run) {
      if (plan.unmappedFiles.length)
        throw new Error("Unmapped paths make the verification scope incomplete. Review and update the domain map before --run.");
      // Preflight every gate before any execution, so a wrong Web Node cannot
      // leave a partially executed cross-surface plan.
      for (const gate of plan.gates) {
        if (gate.node_major && Number(process.versions.node.split('.')[0]) !== gate.node_major)
          throw new Error(`Gate ${gate.id} requires Node ${gate.node_major}; current ${process.version}. Switch Node and rerun the plan.`);
      }
      for (const gate of plan.gates) {
        console.log(`\nRunning ${gate.id}: ${displayCommand(gate)}`);
        const result = spawnSync(gate.command[0], gate.command.slice(1), { cwd: resolve(status.root, gate.cwd), stdio: 'inherit', shell: false });
        if (result.error)
          throw new Error(`Cannot execute ${gate.id}: ${result.error.message}`);
        if (result.status !== 0) {
          console.error(`Gate ${gate.id} failed (${result.signal ?? result.status}); remaining gates were not run. Record the baseline delta; do not fix unrelated failures.`);
          process.exitCode = result.status || 1;
          break;
        }
      }
    }
  }
}
catch (error) {
  console.error(`[agent:verify] ${error.message}`);
  process.exitCode = 1;
}
