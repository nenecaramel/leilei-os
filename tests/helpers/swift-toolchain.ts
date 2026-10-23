import { spawnSync } from 'node:child_process';

// macOS reaches swiftc through xcrun; Linux CI images ship swiftc directly.
// Tests that compile Swift skip, with this reason, only where neither exists.
export const swiftc = (args: string[]): [string, string[]] =>
  process.platform === 'darwin' ? ['xcrun', ['swiftc', ...args]] : ['swiftc', args];

const [probe, probeArgs] = swiftc(['--version']);
export const swiftUnavailable: string | false =
  spawnSync(probe, probeArgs, { encoding: 'utf8', timeout: 10_000 }).status === 0 ? false : 'Swift toolchain (swiftc) not installed';
