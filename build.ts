/**
 * Production build for the Atuin Dashboard.
 *
 * Stage 1 emits web assets to ./dist for a source-run deployment.
 * Stage 2 compiles standalone binaries to ./binaries.
 *
 * Migrations are embedded via src/db/migrations-embedded.ts, which imports the
 * .sql files with `type: "text"` so they survive into the single-file binary.
 * The manifest is regenerated first so it can never lag behind drizzle/.
 *
 * `bytecode` is deliberately off: src/server.ts awaits Migrator.run() at the
 * top level, which bytecode compilation does not support.
 */
import twPlugin from "bun-plugin-tailwind";

type BunCrossTarget =
  | "bun-linux-x64"
  | "bun-linux-arm64"
  | "bun-darwin-x64"
  | "bun-darwin-arm64"
  | "bun-windows-x64";

interface BinaryTarget {
  target: BunCrossTarget;
  outfile: string;
}

const ENTRY = "./src/server.ts";

const targets: BinaryTarget[] = [
  { target: "bun-linux-x64", outfile: "./binaries/atuin-dashboard-linux-x64" },
  { target: "bun-linux-arm64", outfile: "./binaries/atuin-dashboard-linux-arm64" },
  { target: "bun-darwin-x64", outfile: "./binaries/atuin-dashboard-macos-x64" },
  { target: "bun-darwin-arm64", outfile: "./binaries/atuin-dashboard-macos-arm64" },
];

/** Only genuinely static values belong here. Paths and credentials vary per
 *  machine and are read at runtime through env-config.ts. */
const define = {
  "process.env.NODE_ENV": JSON.stringify("production"),
  "process.env.BUILD_TIME": JSON.stringify(new Date().toISOString()),
};

// Restrict to the host platform with: bun run build.ts --current
const currentOnly = process.argv.includes("--current");
/** Maps the host to its release target, rather than assuming linux. */
function hostTarget(): BunCrossTarget | null {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `bun-darwin-${arch}` as BunCrossTarget;
  if (process.platform === "linux") return `bun-linux-${arch}` as BunCrossTarget;
  // Windows: only x64 is published, and the previous expression silently
  // selected a linux binary here.
  if (process.platform === "win32" && arch === "x64") return "bun-windows-x64";
  return null;
}

const host = hostTarget();
if (currentOnly && !host) {
  console.error(`No Bun target for ${process.platform}/${process.arch}.`);
  process.exit(1);
}
const selected = currentOnly ? targets.filter((t) => t.target === host) : targets;
if (currentOnly && selected.length === 0) {
  console.error(`Host target ${host} is not in the configured target list.`);
  process.exit(1);
}

console.log("🏗️  Building atuin-dashboard\n");

// ─── Stage 0: migration manifest ────────────────────────────────────────────
console.log("📜 Regenerating embedded migration manifest...");
const embed = Bun.spawnSync(["bun", "run", "scripts/embed-migrations.ts"], {
  stdout: "inherit",
  stderr: "inherit",
});
if (embed.exitCode !== 0) {
  console.error("❌ Migration manifest generation failed.");
  process.exit(1);
}

// ─── Stage 1: web assets ────────────────────────────────────────────────────
console.log("\n🧹 Cleaning ./dist and ./binaries...");
await Bun.$`rm -rf ./dist ./binaries`.quiet();
await Bun.$`mkdir -p ./binaries`.quiet();

console.log("🎨 Stage 1: building web assets → ./dist");
const webResult = await Bun.build({
  entrypoints: [ENTRY],
  outdir: "./dist",
  target: "bun",
  minify: true,
  sourcemap: "external",
  plugins: [twPlugin],
  define: { ...define, "process.env.RUN_MODE": JSON.stringify("source") },
});

if (!webResult.success) {
  console.error("❌ Web asset build failed:");
  for (const log of webResult.logs) console.error(`   ${log.message}`);
  process.exit(1);
}
console.log(`   ✅ ${webResult.outputs.length} artefact(s)`);

// ─── Stage 2: binaries ──────────────────────────────────────────────────────
console.log("\n📦 Stage 2: compiling binaries → ./binaries");
let allPassed = true;

for (const { target, outfile } of selected) {
  process.stdout.write(`   ${target}...`);

  const result = await Bun.build({
    entrypoints: [ENTRY],
    compile: { outfile, target },
    plugins: [twPlugin],
    minify: true,
    target: "bun",
    define: { ...define, "process.env.RUN_MODE": JSON.stringify("binary") },
  });

  if (!result.success) {
    console.log(" ❌");
    for (const log of result.logs) console.error(`      ${log.message}`);
    allPassed = false;
    continue;
  }

  // result.outputs[0].size reads 0 for compiled binaries; stat the file.
  const size = Bun.file(outfile).size;
  console.log(` ✅  (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

if (!allPassed) {
  console.error("\n❌ One or more binary builds failed.");
  process.exit(1);
}

console.log("\n🎉 Build successful!");
console.log("   📂 Web assets: ./dist/");
console.log("   📂 Binaries:   ./binaries/");
console.log("\n⚠️  Verify the artefact, not the source tree:");
console.log("   run a binary from an unrelated directory to confirm the");
console.log("   embedded migrations and web assets resolve correctly.");
