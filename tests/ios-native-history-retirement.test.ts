import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('retired iOS display snapshot refresh clears stale history without an API dependency', { skip: process.platform !== 'darwin' }, () => {
  const source = readFileSync('ios/LeileiOS/LeileiOS/App/ConversationCoordination.swift', 'utf8');
  const start = source.indexOf('    func refreshNativeLiveConversationHistorySnapshot() async {');
  const end = source.indexOf('    func refreshNativeLiveCurrentPath(', start);
  assert.ok(start >= 0 && end > start);
  const method = source.slice(start, end);
  const directory = mkdtempSync(join(tmpdir(), 'leileios-history-retirement-swift-'));
  try {
    const input = join(directory, 'main.swift'), output = join(directory, 'fixture');
    // Compile and run the actual production method with only its remaining
    // state owner. Adding an HTTP dependency makes this fixture fail to build.
    writeFileSync(input, `import Foundation
@MainActor final class SnapshotOwner {
    var nativeLiveHistorySnapshot: Int? = 813
${method}
}
@main struct Fixture {
    @MainActor static func main() async {
        let owner = SnapshotOwner()
        await owner.refreshNativeLiveConversationHistorySnapshot()
        precondition(owner.nativeLiveHistorySnapshot == nil)
        await owner.refreshNativeLiveConversationHistorySnapshot()
        precondition(owner.nativeLiveHistorySnapshot == nil)
    }
}
`);
    const compiled = spawnSync('swiftc', ['-parse-as-library', input, '-o', output], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const result = spawnSync(output, [], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
