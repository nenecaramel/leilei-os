import postgres from "postgres";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the pre-deploy connectivity probe.");
  }

  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: "require",
  });

  try {
    const rows = await client<{ ok: number }[]>`select 1 as ok`;
    if (rows[0]?.ok !== 1) {
      throw new Error("Unexpected database connectivity probe result.");
    }
  } finally {
    await client.end();
  }
}

main().catch(() => {
  console.error("Pre-deploy database connectivity probe failed.");
  process.exitCode = 1;
});
