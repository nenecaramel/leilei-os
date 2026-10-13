import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Use the native parser's source ranges, not indentation or hand-counted
// braces. Consumers compile these bodies inside actor-matched harnesses;
// this is not a substitute for compiling or rendering the whole SwiftUI app.
export function swiftDeclarations(path: string) {
  const source = readFileSync(path, 'utf8');
  const lines = source.split(/(?<=\n)/u);
  const starts: number[] = []; let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length; }
  const parsed = execFileSync('swiftc', ['-frontend', '-dump-parse', path], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const declarations = [...parsed.matchAll(/^\s*\((func_decl|struct_decl)[^\n]*?range=\[.+?:(\d+):(\d+) - line:(\d+):(\d+)\] "([^"]+)"/gmu)];
  const position = (line: number, column: number) => {
    assert.ok(line >= 1 && line <= lines.length, 'Swift source range line');
    const bytes = Buffer.from(lines[line - 1]);
    assert.ok(column >= 0 && column <= bytes.length, 'Swift source range column');
    return starts[line - 1] + bytes.subarray(0, column).toString('utf8').length;
  };
  return (kind: 'func_decl' | 'struct_decl', signature: string): string => {
    const matches = declarations.filter(match => match[1] === kind && match[6] === signature);
    assert.equal(matches.length, 1, `Expected one Swift ${kind} ${signature}; got ${matches.length}`);
    const [, , startLine, startColumn, endLine, endColumn] = matches[0];
    return source.slice(position(Number(startLine), Number(startColumn) - 1), position(Number(endLine), Number(endColumn)));
  };
}
