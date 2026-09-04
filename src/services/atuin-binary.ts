import { join } from "node:path";
import { chmod, mkdir, rm } from "node:fs/promises";
import { envConfig } from "../env-config";

/** Release fetched when none is installed; overridable via ATUIN_VERSION. */
export function defaultAtuinVersion(): string {
  return envConfig.ATUIN_VERSION;
}

interface TargetSpec {
  /** Rust target triple used in the release asset name. */
  triple: string;
}

/**
 * Maps the running platform to an atuin release target.
 *
 * musl is preferred on Linux: the binary is static, so it runs on a slim
 * Debian or Alpine image without matching the host's glibc.
 */
export function resolveTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): TargetSpec | null {
  if (platform === "linux") {
    if (arch === "x64") return { triple: "x86_64-unknown-linux-musl" };
    if (arch === "arm64") return { triple: "aarch64-unknown-linux-musl" };
  }
  if (platform === "darwin") {
    if (arch === "x64") return { triple: "x86_64-apple-darwin" };
    if (arch === "arm64") return { triple: "aarch64-apple-darwin" };
  }
  return null;
}

/** Where a downloaded binary is kept: dashboard-owned and writable. */
export function managedBinPath(): string {
  return join(envConfig.RUNTIME_CONFIG_DIR, "bin", "atuin");
}

/** Where the resolved binary came from, for reporting. */
export type BinSource = "env" | "system" | "managed" | "missing";

export interface ResolvedBin {
  /** Absolute path, or "atuin" if nothing was found. */
  path: string;
  source: BinSource;
}

/**
 * Finds which `atuin` to run.
 *
 * 1. ATUIN_BIN — an operator's explicit choice always wins.
 * 2. A system install on PATH — what local development already uses, so the
 *    dashboard drives the same binary as the developer's own shell.
 * 3. A binary this dashboard downloaded — the fallback for a container or host
 *    where atuin was never installed.
 *
 * System is preferred over managed so a normal `bun run dev` needs no download
 * at all. To force the managed copy (say, a newer release than the system one),
 * set ATUIN_BIN to the path that {@link managedBinPath} reports.
 */
export async function findAtuinBin(): Promise<ResolvedBin> {
  const explicit = envConfig.ATUIN_BIN;
  if (explicit) return { path: explicit, source: "env" };

  const system = Bun.which("atuin");
  if (system) return { path: system, source: "system" };

  const managed = managedBinPath();
  if (await Bun.file(managed).exists()) return { path: managed, source: "managed" };

  return { path: "atuin", source: "missing" };
}

/** Convenience for callers that only need something to spawn. */
export async function resolveAtuinBin(): Promise<string> {
  return (await findAtuinBin()).path;
}

export interface InstallProgress {
  step: string;
  detail?: string;
}

/**
 * Downloads the atuin client from GitHub Releases and installs it.
 *
 * The published .sha256 is fetched and checked before anything is extracted or
 * marked executable: this code runs a downloaded binary, so an unverified
 * artefact would be a supply-chain hole rather than a convenience.
 *
 * @throws if the platform is unsupported, the download fails, or the digest
 *         does not match.
 */
export async function installAtuin(
  version: string = defaultAtuinVersion(),
  onProgress: (p: InstallProgress) => void = () => {}
): Promise<{ path: string; version: string }> {
  const target = resolveTarget();
  if (!target) {
    throw new Error(
      `No atuin release for ${process.platform}/${process.arch}. Install atuin manually and set ATUIN_BIN.`
    );
  }

  // The version reaches this function from an HTTP body. Interpolating it
  // unchecked lets a caller steer the URL to any path on the host -- and the
  // sha256 does not help, because the digest is fetched from that same
  // attacker-chosen location. The result would be an arbitrary binary
  // downloaded, marked executable, and then run by this process.
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Invalid atuin version ${JSON.stringify(version)}: expected a release like "18.20.1".`
    );
  }

  const asset = `atuin-${target.triple}.tar.gz`;
  const base = `https://github.com/atuinsh/atuin/releases/download/v${version}/${asset}`;

  // Bounded: without a timeout a stalled connection hangs the request handler
  // indefinitely, and this runs from an HTTP endpoint.
  const DOWNLOAD_TIMEOUT_MS = 120_000;

  onProgress({ step: "fetching checksum", detail: `${asset}.sha256` });
  const sumRes = await fetch(`${base}.sha256`, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!sumRes.ok) {
    throw new Error(`Could not fetch checksum for atuin v${version} (${sumRes.status}).`);
  }
  // The file is "<hex>  <filename>"; take the digest only.
  const expected = (await sumRes.text()).trim().split(/\s+/)[0]?.toLowerCase();
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error("Checksum file was not a valid sha256 digest.");
  }

  onProgress({ step: "downloading", detail: asset });
  const binRes = await fetch(base, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!binRes.ok) {
    throw new Error(`Download failed for atuin v${version} (${binRes.status}).`);
  }
  const bytes = new Uint8Array(await binRes.arrayBuffer());

  onProgress({ step: "verifying", detail: "sha256" });
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}. Refusing to install.`
    );
  }

  onProgress({ step: "extracting" });
  // Unique per install: two concurrent requests sharing one directory would
  // have the first's rm delete the second's partly-extracted files.
  const workDir = join(
    envConfig.RUNTIME_CONFIG_DIR,
    `.atuin-download-${process.pid}-${Date.now().toString(36)}`
  );
  await mkdir(workDir, { recursive: true });

  // try/finally from here: every throw below (extract failure, missing
  // binary, a failed write or chmod) previously left the full archive behind
  // under RUNTIME_CONFIG_DIR, and the unique name means the next attempt
  // cannot reclaim it. The endpoint is reachable over HTTP, so repeated
  // failures accumulate disk until someone deletes them by hand.
  const dest = managedBinPath();
  try {
    const tarPath = join(workDir, asset);
    await Bun.write(tarPath, bytes);

    // --strip-components drops the versioned top-level directory in the tarball.
    const untar = Bun.spawn(["tar", "-xzf", tarPath, "-C", workDir, "--strip-components=1"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if ((await untar.exited) !== 0) {
      throw new Error(`Extract failed: ${await new Response(untar.stderr).text()}`);
    }

    await mkdir(join(envConfig.RUNTIME_CONFIG_DIR, "bin"), { recursive: true });
    const extracted = Bun.file(join(workDir, "atuin"));
    if (!(await extracted.exists())) {
      throw new Error("Archive did not contain an `atuin` binary.");
    }
    await Bun.write(dest, extracted);
    await chmod(dest, 0o755);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  onProgress({ step: "installed", detail: dest });
  return { path: dest, version };
}
