import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { testConcurrency, testFiles, testPlan } from "../scripts/run-tests.mjs";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "test-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(["scripts", "tests/nested", "web/src/pages"].map(path => mkdir(join(root, path), { recursive: true })));
  await Promise.all([
    copyFile("scripts/run-tests.mjs", join(root, "scripts/run-tests.mjs")),
    copyFile("scripts/test-timing-reporter.mjs", join(root, "scripts/test-timing-reporter.mjs")),
    copyFile("tests/register-css-loader.mjs", join(root, "tests/register-css-loader.mjs")),
    copyFile("tests/css-loader-hooks.mjs", join(root, "tests/css-loader-hooks.mjs")),
    copyFile("web/tsconfig.app.json", join(root, "web/tsconfig.app.json")),
    writeFile(join(root, "package.json"), '{"type":"module"}'),
    symlink(resolve("node_modules"), join(root, "node_modules"), "dir"),
    symlink(resolve("web/node_modules"), join(root, "web/node_modules"), "dir"),
  ]);
  return root;
}

function run(root: string, args: string[] = []) {
  // Fixtures never inherit opt-in database/device flags or application credentials.
  const child = spawn(process.execPath, [join(root, "scripts/run-tests.mjs"), ...args], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  return new Promise<{ code: number | null; output: string }>((accept, reject) => {
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => { clearTimeout(timeout); accept({ code, output }); });
  });
}

test("shared-resource opt-ins force serial execution; callers cannot override isolation", () => {
  assert.equal(testConcurrency({}), 2);
  assert.equal(testConcurrency({}, true), 1);
  for (const key of ["RUN_DATABASE_INTEGRATION_TEST", "DATABASE_URL", "UI_TEST_DEVICE", "IOS_SIMULATOR_UDID", "SAFARI_WEBDRIVER_URL", "LIFECYCLE_BOUNDARY_FIXTURES"]) {
    for (const value of ["1", "0", "false"]) assert.equal(testConcurrency({ [key]: value }), 1);
  }
  for (const argument of ["--test-concurrency=8", "--test-concurrency", "--test-isolation=none", "--experimental-test-isolation=none"]) {
    assert.throws(() => testPlan(".", [argument], {}), /managed by the test runner/);
  }
});

test("discovery includes nested tests exactly once and excludes helpers and symlinks", async t => {
  const root = await fixture(t);
  await Promise.all([
    writeFile(join(root, "tests/a.test.ts"), ""),
    writeFile(join(root, "tests/nested/b.test.ts"), ""),
    writeFile(join(root, "tests/helper.ts"), ""),
    symlink(join(root, "tests/a.test.ts"), join(root, "tests/alias.test.ts")),
  ]);
  assert.deepEqual(testFiles(root), [join(root, "tests/a.test.ts"), join(root, "tests/nested/b.test.ts")]);
  assert.equal(testPlan(root, ["--", "--serial"], {}).concurrency, 1);
});

test("default runner actually executes two isolated files concurrently using an explicit barrier", async t => {
  const root = await fixture(t);
  const waiting: import("node:http").ServerResponse[] = [];
  const pids = new Set<string>();
  const server = createServer((request, response) => {
    pids.add(request.url!);
    waiting.push(response);
    if (waiting.length === 2) for (const item of waiting) item.end("released");
  });
  await new Promise<void>(accept => server.listen(0, "127.0.0.1", accept));
  t.after(() => { for (const item of waiting) item.destroy(); server.closeAllConnections(); server.close(); });
  const port = (server.address() as import("node:net").AddressInfo).port;
  for (const name of ["a", "b"]) await writeFile(join(root, `tests/${name}.test.ts`), `
    import test from 'node:test'; import assert from 'node:assert/strict';
    test('${name}', async () => {
      globalThis.marker = '${name}';
      const response = await fetch('http://127.0.0.1:${port}/' + process.pid);
      assert.equal(await response.text(), 'released');
      assert.equal(globalThis.marker, '${name}');
    });
  `);
  const result = await run(root);
  assert.equal(result.code, 0, result.output);
  assert.equal(waiting.length, 2);
  assert.equal(pids.size, 2, "each file must run in a different child process");
});

test("serial runner preserves failures and profile contains metadata without stdout or diagnostics", async t => {
  const root = await fixture(t);
  await writeFile(join(root, "tests/a.test.ts"), `
    import test from 'node:test'; import assert from 'node:assert/strict';
    test('private-test-name', t => { console.log('PRIVATE_STDOUT'); t.diagnostic('PRIVATE_DIAGNOSTIC'); });
    test('failure', () => assert.fail('PRIVATE_FAILURE'));
  `);
  const result = await run(root, ["--serial", "--profile"]);
  assert.notEqual(result.code, 0, "a failing test must fail the runner");
  assert.match(result.output, /PRIVATE_FAILURE/);
  const content = await readFile(join(root, "test-results/timings.jsonl"), "utf8");
  assert.doesNotMatch(content, /PRIVATE_|private-test-name/);
  const rows = content.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => row.failed).length, 1);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ["duration_ms", "failed", "file", "skipped"]);
});


test("actual runner loads CSS and renders production TSX using the Web automatic JSX runtime", async t => {
  const root = await fixture(t);
  await copyFile("web/src/pages/PaperAuthorSignature.tsx", join(root, "web/src/pages/PaperAuthorSignature.tsx"));
  await writeFile(join(root, "tests/fixture.css"), "body { color: red; }");
  await writeFile(join(root, "tests/render.test.ts"), `
    import test from 'node:test'; import assert from 'node:assert/strict';
    import './fixture.css';
    import React from ${JSON.stringify(resolve("web/node_modules/react/index.js"))};
    import { renderToStaticMarkup } from ${JSON.stringify(resolve("web/node_modules/react-dom/server.js"))};
    import { PaperAuthorSignature } from '../web/src/pages/PaperAuthorSignature.tsx';
    test('actual production JSX', () => assert.match(renderToStaticMarkup(React.createElement(PaperAuthorSignature, {value:'L',editable:false,placement:'inline'})), />L</));
  `);
  const result = await run(root, ["--serial"]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /actual production JSX/);
});
