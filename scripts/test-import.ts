// Quick local test of the schedule importer.
// Run: npx tsx scripts/test-import.ts <path-to-xlsx>
import fs from "node:fs";
import { parseScheduleWorkbook } from "../src/lib/importer/xlsx";

const path = process.argv[2];
if (!path) {
  console.error("usage: tsx scripts/test-import.ts <xlsx>");
  process.exit(1);
}

const buf = fs.readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const { games, warnings } = parseScheduleWorkbook(ab as ArrayBuffer);

console.log(`Parsed ${games.length} games`);

const byDiv: Record<string, number> = {};
for (const g of games) byDiv[g.division_code] = (byDiv[g.division_code] || 0) + 1;
console.log("By division:", byDiv);

console.log("\nFirst 5:");
for (const g of games.slice(0, 5)) console.log(g);

if (warnings.length) {
  console.log(`\n${warnings.length} warnings:`);
  for (const w of warnings.slice(0, 10)) console.log(" ", w);
}
