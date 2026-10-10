import { execFileSync, spawnSync } from "node:child_process";

const EXPECTED_DB = "leileios_native_session_test";
const EXPECTED_CONTAINER = "leileios-pr1003-pg";
const EXPECTED_HOST = "127.0.0.1";
const EXPECTED_PORT = "60449";

if (process.env.NODE_ENV === "production" ||
    process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() === "production" ||
    process.env.RAILWAY_ENVIRONMENT_ID) {
  throw new Error("Refusing to run isolated semantic tests in a Railway/production environment.");
}

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const exposed = docker(["port", EXPECTED_CONTAINER, "5432/tcp"]);
if (exposed !== `${EXPECTED_HOST}:${EXPECTED_PORT}`) {
  throw new Error(`Refusing unexpected disposable database port binding: ${exposed}`);
}
const dockerEnvironment = docker([
  "inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", EXPECTED_CONTAINER,
]).split("\n");
const variables = new Map(dockerEnvironment.map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
const dbName = variables.get("POSTGRES_DB");
const dbUser = variables.get("POSTGRES_USER");
const dbPassword = variables.get("POSTGRES_PASSWORD");
if (dbName !== EXPECTED_DB || !dbUser || !dbPassword) {
  throw new Error("Refusing unknown disposable Postgres DB identity or missing local credentials.");
}

const url = new URL(`postgresql://${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DB}`);
url.username = dbUser;
url.password = dbPassword;
const environment = {
  ...process.env,
  DATABASE_URL: url.toString(),
  RUN_NATIVE_LIVE_SEMANTIC_256_DATABASE_TEST: "1",
};
// Do not print environment, connection URI or local-only credentials.
const commands = [
  // Catch missing imports and type contract drift before mutating even the disposable DB.
  ["typecheck"],
  ["db:migrate"],
  ["db:check"],
  ["exec", "tsx", "--test", "tests/native-live-semantic-256.integration.test.ts"],
];
for (const args of commands) {
  const result = spawnSync("pnpm", args, { env: environment, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("SEMANTIC_256_DISPOSABLE_PASS");
