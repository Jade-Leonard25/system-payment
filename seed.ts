import { unlink, writeFile } from "node:fs/promises";
import { hashProductKey, generateKeySegment, generateProductKey } from "./key-products";

const KEY_COUNT = 1000;
const BATCH_SIZE = 100;
const HASH_CONCURRENCY = 8;
const target = process.argv.includes("--remote") ? "--remote" : "--local";
const selectors = new Set<string>();
const seededKeys: string[] = [];

async function createSeedRow() {
  let keySelector = generateKeySegment();
  while (selectors.has(keySelector)) {
    keySelector = generateKeySegment();
  }
  selectors.add(keySelector);

  const { key } = generateProductKey(keySelector);
  seededKeys.push(key);
  const keyHash = await hashProductKey(key);
  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  return `('${id}', '${keySelector}', '${keyHash}', 'active', ${createdAt})`;
}

async function main() {
  const tempFile = `/tmp/system-payment-key-seed-${crypto.randomUUID()}.sql`;
  const keysFile = `./seeded-keys-${crypto.randomUUID()}.txt`;
  try {
    const rows: string[] = [];
    for (let start = 0; start < KEY_COUNT; start += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, KEY_COUNT - start);
      const batch: string[] = [];
      for (let offset = 0; offset < batchSize; offset += HASH_CONCURRENCY) {
        const rowCount = Math.min(HASH_CONCURRENCY, batchSize - offset);
        batch.push(...await Promise.all(Array.from({ length: rowCount }, createSeedRow)));
      }
      rows.push(
        `INSERT INTO key_product (id, key_selector, key_hash, status, created_at) VALUES ${batch.join(", ")};`,
      );
    }

    await Bun.write(tempFile, rows.join("\n"));
    const migration = Bun.spawn(
      ["bunx", "wrangler", "d1", "migrations", "apply", "system-payroll", target],
      { stdout: "inherit", stderr: "inherit" },
    );
    const migrationExitCode = await migration.exited;
    if (migrationExitCode !== 0) {
      throw new Error(`Wrangler D1 migration failed with exit code ${migrationExitCode}`);
    }

    const seedProcess = Bun.spawn(
      ["bunx", "wrangler", "d1", "execute", "system-payroll", target, "--file", tempFile],
      { stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await seedProcess.exited;
    if (exitCode !== 0) {
      throw new Error(`Wrangler D1 seed failed with exit code ${exitCode}`);
    }

    await writeFile(keysFile, `${seededKeys.join("\n")}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    console.log(`Seeded ${seededKeys.length} keys. Store the generated keys securely: ${keysFile}`);
  } finally {
    await unlink(tempFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

await main();
