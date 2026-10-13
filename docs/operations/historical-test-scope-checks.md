# Historical PR scope checks

These checks guarded the file scope of three completed iOS extraction branches.
They are archived here as provenance, not active product regression tests.
Running them on later branches would reject legitimate feature changes; their
branch-name conditions therefore skipped them on `main`.

Original source snapshot: `6f1fad855c7c9972e637685388dffcde49eb899e`.
The complete fragments below are preserved without edits. They rely on the
imports/helpers in that snapshot. Do not run or restore these branch-specific
checks as a gate for future work. Current component, state ownership,
request/navigation and presentation assertions remain in the test files.

## ios-dayspace-boundaries.test.ts

Source: [tests/ios-dayspace-boundaries.test.ts](https://github.com/nenecaramel/leilei-os/blob/6f1fad855c7c9972e637685388dffcde49eb899e/tests/ios-dayspace-boundaries.test.ts)

Fragment SHA-256: `7dbc517d7fc3cd92d401a4653044fb21bbc9d71c98a127952cd0f1d400752797`

```ts
// Scope this refactor's diff gate to its branch, without freezing unrelated future work.
const branch = process.env.GITHUB_HEAD_REF
  ?? execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
test("Day Space structural branch changes only its root, presentation/support and boundary tests", {
  skip: branch !== "refactor/ios-day-space-structure",
}, () => {
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  const allowed = new Set([
    `${root}DaySpaceView.swift`, `${root}DaySpace/DaySpaceSearch.swift`,
    `${root}DaySpace/DaySpaceContent.swift`, `${root}DaySpace/DaySpaceTodoSearchSupport.swift`,
    "tests/ios-dayspace-boundaries.test.ts",
  ]);
  for (const args of [["diff", "--name-only", base], ["diff", "--cached", "--name-only"]]) {
    const paths = execFileSync("git", args, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    assert.deepEqual(paths.filter(path => !allowed.has(path)), []);
  }
});
```

## ios-global-search-boundaries.test.ts

Source: [tests/ios-global-search-boundaries.test.ts](https://github.com/nenecaramel/leilei-os/blob/6f1fad855c7c9972e637685388dffcde49eb899e/tests/ios-global-search-boundaries.test.ts)

Fragment SHA-256: `47d61f3e17ac1a757bf8932ca22fb94b6131fc19abde6c57a04c11197a24439a`

```ts
// This PR's scope gate must not freeze API/backend files for future feature branches.
const branch = process.env.GITHUB_HEAD_REF
  ?? execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
test("Global Search structural branch leaves API and backend tracked files untouched", {
  skip: branch !== "refactor/ios-global-search-structure",
}, () => {
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  for (const args of [["diff", "--name-only", base], ["diff", "--cached", "--name-only"]]) {
    const paths = execFileSync("git", args, { encoding: "utf8" }).trim().split("\n");
    assert.deepEqual(paths.filter(path => /^(?:src\/|drizzle\/|railway)|\/Infrastructure\/API\/|GlobalSearchService\.swift$/.test(path)), []);
  }
});
```

## ios-settings-boundaries.test.ts

Source: [tests/ios-settings-boundaries.test.ts](https://github.com/nenecaramel/leilei-os/blob/6f1fad855c7c9972e637685388dffcde49eb899e/tests/ios-settings-boundaries.test.ts)

Fragment SHA-256: `d44d62743bf469e069c4c5e88ea058c479a3fb7558f824f3df60c79e89a93de6`

```ts
const branch = process.env.GITHUB_HEAD_REF
  ?? execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
test("Settings structural branch changes only its iOS presentation and tests", {
  skip: branch !== "refactor/ios-settings-structure",
}, () => {
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const allowed = new Set([
    navigation + "SettingsSheetView.swift",
    ...["HomeContent", "SummaryContent", "Presentation"].map(name => navigation + `Settings/Settings${name}.swift`),
    "tests/ios-settings-boundaries.test.ts",
    "tests/ios-settings-export-restore-v4.test.ts",
  ]);
  for (const file of files) assert.ok(allowed.has(file), `out-of-scope diff: ${file}`);
});
```

