// Fetch raw Composio tool schemas for the target toolkits via REST v3.
// Usage: node scripts/fetch-tools.mjs
import { writeFile, mkdir } from "fs/promises";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf-8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

const API_KEY = env.COMPOSIO_API_KEY;
const BASE = "https://backend.composio.dev/api/v3/tools";
const TOOLKITS = ["googlesuper", "github"];

async function fetchToolkit(slug) {
  const items = [];
  let cursor = null;
  for (;;) {
    const url = new URL(BASE);
    url.searchParams.set("toolkit_slug", slug);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { "x-api-key": API_KEY } });
    if (!res.ok) throw new Error(`${slug}: HTTP ${res.status} ${await res.text()}`);
    const data = await res.json();
    items.push(...data.items);
    cursor = data.next_cursor ?? null;
    process.stdout.write(`\r${slug}: ${items.length} tools...`);
    if (!cursor) break;
  }
  console.log(`\n${slug}: ${items.length} total`);
  return items;
}

await mkdir(new URL("../data", import.meta.url), { recursive: true });
for (const slug of TOOLKITS) {
  const tools = await fetchToolkit(slug);
  await writeFile(
    new URL(`../data/${slug}_tools.json`, import.meta.url),
    JSON.stringify(tools, null, 2)
  );
}
console.log("done");
