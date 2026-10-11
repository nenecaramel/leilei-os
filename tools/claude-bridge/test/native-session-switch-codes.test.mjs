import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Every sanitized code reachable from the switch command must survive to the
// user instead of collapsing into a generic inspection failure.
async function reachableCodes(entry) {
  const seen = new Set(), codes = new Set(), queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    // Includes conditional fail(a ? 'X' : 'Y') branches and re-thrown code sets.
    for (const [, code] of source.matchAll(/['"]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"]/g)) codes.add(code);
    for (const [, specifier] of source.matchAll(/from ['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)) queue.push(path.resolve(path.dirname(file), specifier));
  }
  return codes;
}

test('switch command exposes every sanitized failure code its modules can raise', async () => {
  const { nativeSwitchErrorCode } = await import('../src/native-session-switch-codes.mjs');
  const codes = await reachableCodes(path.join(root, 'scripts/native-session-switch.mjs'));
  for (const code of ['NATIVE_RESTORE_TIMEOUT', 'NATIVE_RESTORE_SERVER_REJECTED', 'NATIVE_SOURCE_SCAN_LIMIT', 'NATIVE_HISTORY_GAP']) assert.ok(codes.has(code), code);
  const hidden = [...codes].filter(code => nativeSwitchErrorCode(Object.assign(new Error(code), { code })) !== code);
  assert.deepEqual(hidden, []);
});

test('switch command still hides unknown and non-sanitized errors', async () => {
  const { nativeSwitchErrorCode } = await import('../src/native-session-switch-codes.mjs');
  assert.equal(nativeSwitchErrorCode(Object.assign(new Error('PRIVATE /Users/x'), { code: 'ENOENT' })), 'NATIVE_INSPECTION_UNAVAILABLE');
  assert.equal(nativeSwitchErrorCode(new Error('PRIVATE')), 'NATIVE_INSPECTION_UNAVAILABLE');
});
