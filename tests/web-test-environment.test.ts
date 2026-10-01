import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

function browserModule(code: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "--import", "./tests/register-css-loader.mjs", "--input-type=module", "-e", code], {
    encoding: "utf8",
    env: { ...process.env, TSX_TSCONFIG_PATH: "./web/tsconfig.app.json" },
  });
}

test("Web component tests use the same automatic JSX runtime as the Web build", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts.test, /--tsconfig \.\/web\/tsconfig\.app\.json/);
  const result = browserModule(`import React from './web/node_modules/react/index.js'; import { renderToStaticMarkup } from './web/node_modules/react-dom/server.js'; import { PaperAuthorSignature } from './web/src/pages/PaperAuthorSignature.tsx'; console.log(renderToStaticMarkup(React.createElement(PaperAuthorSignature, {value:'L',editable:false,placement:'inline'})));`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, />L</);
});

test("Node Web tests provide an explicit unconfigured Vite auth fixture without browser globals", () => {
  const result = browserModule(`import assert from 'node:assert/strict'; import {authConfig} from './web/src/config/auth.ts'; assert.equal(authConfig,null); assert.equal(typeof globalThis.window,'undefined');`);
  assert.equal(result.status, 0, result.stderr);
});
