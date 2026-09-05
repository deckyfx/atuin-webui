import { Elysia, t } from "elysia";
import { TransactionRollbackError } from "drizzle-orm";
import { UserStore } from "../stores/user-store";
import { SessionStore } from "../stores/session-store";
import { StatsStore } from "../stores/stats-store";
import { HistoryStore } from "../stores/history-store";
import { AtuinCli } from "../services/atuin-cli";
import type { SearchRule } from "../services/atuin-cli";
import { readClientMeta, historyAvailable, HistoryUnavailableError } from "../db/history";
import { AuditStore } from "../stores/audit-store";
import { Doctor } from "../services/doctor";
import { installAtuin } from "../services/atuin-binary";
import { envConfig } from "../env-config";
import { isAuthorised } from "../services/auth";

/** Body schema for a batch-selection rule. Mirrors {@link SearchRule}. */
/**
 * Verb lists for the purge routes.
 *
 * The pattern rejects whitespace-only entries at the boundary. `minLength: 1`
 * accepts " ", which the service then refuses — correctly, but as a 500, which
 * describes a bad request as a server fault.
 */
const verbListSchema = t.Object({
  verbs: t.Array(t.String({ minLength: 1, pattern: "\\S" }), {
    minItems: 1,
    maxItems: 50,
  }),
});

const ruleSchema = t.Object({
  query: t.String(),
  searchMode: t.Optional(
    t.Union([
      t.Literal("prefix"),
      t.Literal("full-text"),
      t.Literal("fuzzy"),
      t.Literal("skim"),
    ])
  ),
  filterMode: t.Optional(
    t.Union([
      t.Literal("global"),
      t.Literal("host"),
      t.Literal("session"),
      t.Literal("directory"),
      t.Literal("workspace"),
    ])
  ),
  cwd: t.Optional(t.String()),
  exit: t.Optional(t.Number()),
  before: t.Optional(t.String()),
  after: t.Optional(t.String()),
  limit: t.Optional(t.Number()),
});

export const apiPlugin = new Elysia({ prefix: "/api" })
  // Every route behind the token. Loopback is not an authorisation boundary:
  // another local account can reach 127.0.0.1, and these endpoints read
  // command text containing credentials and delete history on every synced
  // machine.
  .onBeforeHandle(({ request, set }) => {
    if (isAuthorised(request)) return;
    set.status = 401;
    return { message: "Unauthorised: supply the dashboard token." };
  })
  // A machine without atuin set up is an expected deployment state (a fresh
  // container on first boot), not a server fault: report it as 503 with the
  // remedy rather than a stack trace.
  .onError(({ error, set }) => {
    if (error instanceof HistoryUnavailableError) {
      set.status = 503;
      return { message: error.message, code: "HISTORY_UNAVAILABLE" };
    }
  })
  // ─── Client: setup / bootstrap ──────────────────────────────────────────
  .get("/setup/status", async () => {
    const meta = readClientMeta();
    const atuinInstalled = await AtuinCli.isInstalled();
    return {
      profile: envConfig.PROFILE,
      loggedIn: meta.loggedIn,
      hostId: meta.hostId,
      atuinInstalled,
      historyAvailable: historyAvailable(),
      // Without the binary there is nothing the setup form can do.
      needsSetup: !meta.loggedIn,
      blocked: !atuinInstalled,
    };
  })
  .post(
    "/setup/login",
    async ({ body, set }) => {
      // Refuse while already bootstrapped: leaving this open would let anyone
      // who can reach the dashboard re-point the client at another account.
      if (readClientMeta().loggedIn) {
        set.status = 409;
        return { message: "Client is already logged in." };
      }

      const res = await AtuinCli.login(body);
      if (!res.ok) {
        set.status = 400;
        return { message: res.stderr.trim() || "Login failed." };
      }
      // Credentials are deliberately not persisted here: atuin writes the
      // session token to meta.db and the key to data_dir/key.
      return { success: true };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 }),
        key: t.String({ minLength: 1 }),
      }),
    }
  )

  // ─── Environment self-check ─────────────────────────────────────────────
  .get("/doctor", async () => await Doctor.run())
  .post(
    "/doctor/install-atuin",
    async ({ body, set }) => {
      const steps: string[] = [];
      try {
        const result = await installAtuin(body?.version, (p) =>
          steps.push(p.detail ? `${p.step}: ${p.detail}` : p.step)
        );
        // The cached "is it installed" probe is now stale.
        AtuinCli.forgetInstalled();
        return { success: true, ...result, steps };
      } catch (err) {
        set.status = 502;
        return {
          success: false,
          message: err instanceof Error ? err.message : "Install failed.",
          steps,
        };
      }
    },
    { body: t.Optional(t.Object({ version: t.Optional(t.String()) })) }
  )

  // ─── Client: history reads ──────────────────────────────────────────────
  .get("/client/overview", async () => await HistoryStore.overview())
  .get(
    "/history",
    async ({ query }) =>
      await HistoryStore.search({
        search: query.search,
        hostname: query.hostname,
        exit: query.exit,
        limit: query.limit,
        offset: query.offset,
      }),
    {
      // t.Numeric coerces and *validates*: as t.String() these reached
      // Number() unchecked, so "abc" became NaN and silently changed the query.
      query: t.Object({
        search: t.Optional(t.String()),
        hostname: t.Optional(t.String()),
        exit: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
        offset: t.Optional(t.Numeric({ minimum: 0 })),
      }),
    }
  )
  .post(
    "/history/preview-exact",
    async ({ body, set }) => {
      try {
        return await AtuinCli.previewExact(body.command);
      } catch (err) {
        set.status = 500;
        return { message: err instanceof Error ? err.message : "Preview failed." };
      }
    },
    { body: t.Object({ command: t.String({ minLength: 1 }) }) }
  )
  .post(
    "/history/delete-exact",
    async ({ body, set }) => {
      // Counted before the delete: `matchedCount` records how many entries
      // went, and 1 was the number of *commands* asked for, not the number of
      // rows removed.
      // No preview, no delete: proceeding would remove history whose scope was
      // never established, irreversibly and on every synced machine. Checked
      // before the audit row is opened so a refusal leaves no dangling entry.
      let matched: number;
      try {
        matched = (await AtuinCli.previewExact(body.command)).total;
      } catch (err) {
        set.status = 503;
        return {
          message: `Refusing to delete: could not preview the scope first. ${
            err instanceof Error ? err.message : ""
          }`.trim(),
        };
      }

      const auditId = await AuditStore.begin({
        action: "delete-exact",
        profile: envConfig.PROFILE,
        rule: { mode: "exact" },
        matchedCount: matched,
        sample: [body.command],
      });

      const res = await AtuinCli.deleteExact(body.command);
      await AuditStore.complete(auditId, {
        succeeded: res.ok,
        // Zero on any failure, not only a refusal: a delete that errored
        // removed nothing, and recording the previewed count would overstate it.
        matchedCount: res.ok ? matched : 0,
        output: (res.stdout || res.stderr).trim(),
      });

      if (!res.ok) {
        // A refusal is the caller asking for something atuin cannot express,
        // not a server fault.
        set.status = res.refused ? 409 : 500;
        return { message: res.stderr, overmatches: res.refused?.overmatches ?? [] };
      }
      return { success: true, output: res.stdout.trim() };
    },
    { body: t.Object({ command: t.String({ minLength: 1 }) }) }
  )
  .post(
    "/history/preview-batch",
    async ({ body, set }) => {
      try {
        // Sequential: concurrent `atuin` processes contend on one sqlite file.
        let total = 0;
        const perCommand: Array<{ command: string; total: number; overmatches: number }> = [];
        for (const command of body.commands) {
          const p = await AtuinCli.previewExact(command);
          total += p.total;
          perCommand.push({
            command,
            total: p.total,
            overmatches: p.overmatches.length,
          });
        }
        return { total, commands: body.commands.length, perCommand };
      } catch (err) {
        set.status = 503;
        return { message: err instanceof Error ? err.message : "Preview failed." };
      }
    },
    {
      body: t.Object({
        commands: t.Array(t.String({ minLength: 1 }), { minItems: 1, maxItems: 500 }),
      }),
    }
  )
  .post(
    "/history/delete-batch",
    async ({ body, set }) => {
      // Sequential rather than parallel: each delete appends to the record
      // store, and concurrent writers would contend on the same sqlite file.
      const auditId = await AuditStore.begin({
        action: "delete-batch",
        profile: envConfig.PROFILE,
        rule: { mode: "exact", requested: body.commands.length },
        sample: body.commands,
      });

      const results: Array<{
        command: string;
        ok: boolean;
        message?: string;
        overmatches?: string[];
      }> = [];

      // Rows removed, not commands accepted: one command can match many
      // entries, so counting successful requests understated the damage in the
      // same way the single-delete path did before it was corrected.
      let removedRows = 0;

      for (const command of body.commands) {
        let matched: number;
        try {
          matched = (await AtuinCli.previewExact(command)).total;
        } catch (err) {
          // Refused rather than deleted blind: the rest of the batch still
          // runs, and this one is reported back.
          results.push({
            command,
            ok: false,
            message: `Skipped: could not preview scope. ${
              err instanceof Error ? err.message : ""
            }`.trim(),
          });
          continue;
        }

        const res = await AtuinCli.deleteExact(command);
        if (res.ok) removedRows += matched;
        results.push({
          command,
          ok: res.ok,
          message: res.ok ? undefined : res.stderr,
          overmatches: res.refused?.overmatches,
        });
      }

      const deleted = results.filter((r) => r.ok).length;
      await AuditStore.complete(auditId, {
        succeeded: deleted === body.commands.length,
        matchedCount: removedRows,
        output: results
          .filter((r) => !r.ok)
          .map((r) => `${r.command}: ${r.message}`)
          .join("\n"),
      });

      const payload = {
        deleted,
        removedRows,
        refused: results.filter((r) => !r.ok),
        total: body.commands.length,
      };
      // `results` always has an entry here: the body requires at least one
      // command, so the length test only obscured the real condition.
      if (deleted === 0) {
        // Nothing was deleted and every command was refused: a 2xx here reads
        // as "done" to anything checking the status line, which is how /dedup
        // already behaves.
        set.status = 500;
      }
      return payload;
    },
    {
      body: t.Object({
        commands: t.Array(t.String({ minLength: 1 }), { minItems: 1, maxItems: 500 }),
      }),
    }
  )
  .get("/history/hosts", async () => await HistoryStore.byHost())
  .get("/history/verbs", async () => await HistoryStore.topVerbs(20))
  .get("/history/activity", async () => await HistoryStore.activity(30))

  // ─── Client: batch mutations ────────────────────────────────────────────
  .post(
    "/prune/preview",
    async ({ body, set }) => {
      try {
        return await AtuinCli.previewDelete(body as SearchRule);
      } catch (err) {
        set.status = 500;
        return { message: err instanceof Error ? err.message : "Preview failed." };
      }
    },
    { body: ruleSchema }
  )
  .post(
    "/prune/execute",
    async ({ body, set }) => {
      const rule = body as SearchRule;
      if (!rule.query.trim()) {
        // An empty query matches everything; require an explicit rule.
        set.status = 400;
        return { message: "Refusing to run a delete with an empty query." };
      }
      // Capture what is about to go: the deletion propagates to every synced
      // machine and the dashboard cannot undo it.
      let matched: { total: number; unique: number; sample: string[] };
      try {
        matched = await AtuinCli.previewDelete(rule);
      } catch (err) {
        // No preview, no delete: an irreversible deletion of unknown scope is
        // exactly what the preview exists to prevent.
        set.status = 503;
        return {
          message: `Refusing to delete: could not preview the scope first. ${
            err instanceof Error ? err.message : ""
          }`.trim(),
        };
      }

      const auditId = await AuditStore.begin({
        action: "delete",
        profile: envConfig.PROFILE,
        rule,
        matchedCount: matched.total,
        sample: matched.sample,
      });

      const res = await AtuinCli.deleteMatching(rule);
      await AuditStore.complete(auditId, {
        succeeded: res.ok,
        // Zero on failure: the row opened with the previewed count, and a
        // delete that errored removed nothing.
        matchedCount: res.ok ? matched.total : 0,
        output: (res.stdout || res.stderr).trim(),
      });

      if (!res.ok) {
        set.status = 500;
        return { message: res.stderr.trim() || "Delete failed." };
      }
      return { success: true, output: res.stdout.trim() };
    },
    { body: ruleSchema }
  )
  .post(
    "/prune/preview-verbs",
    async ({ body, set }) => {
      try {
        // Sequential, not Promise.all: concurrent `atuin` processes contend on
        // the same sqlite file and the losers exit non-zero.
        const perVerb = [];
        for (const verb of body.verbs) {
          perVerb.push(await AtuinCli.previewVerb(verb));
        }
        return {
          perVerb,
          total: perVerb.reduce((n, p) => n + p.total, 0),
          unique: perVerb.reduce((n, p) => n + p.unique, 0),
          bare: perVerb.reduce((n, p) => n + p.bare, 0),
          sample: perVerb.flatMap((p) => p.sample).slice(0, 200),
        };
      } catch (err) {
        set.status = 500;
        return { message: err instanceof Error ? err.message : "Preview failed." };
      }
    },
    { body: verbListSchema }
  )
  .post(
    "/prune/execute-verbs",
    async ({ body, set }) => {
      // Sequential: each delete appends to the record store, and concurrent
      // writers would contend on the same sqlite file.
      const auditId = await AuditStore.begin({
        action: "purge-verbs",
        profile: envConfig.PROFILE,
        rule: { verbs: body.verbs, mode: "verb-prefix" },
      });

      const results: Array<{ verb: string; ok: boolean; removed: number; message?: string }> = [];

      for (const verb of body.verbs) {
        let removed: number;
        try {
          removed = (await AtuinCli.previewVerb(verb)).total;
        } catch (err) {
          results.push({
            verb,
            ok: false,
            removed: 0,
            message: `Skipped: could not preview scope. ${
              err instanceof Error ? err.message : ""
            }`.trim(),
          });
          continue;
        }
        const res = await AtuinCli.deleteVerb(verb);
        results.push({
          verb,
          ok: res.ok,
          removed: res.ok ? removed : 0,
          message: res.ok ? undefined : (res.stderr || "").trim(),
        });
      }

      const removed = results.reduce((n, r) => n + r.removed, 0);
      await AuditStore.complete(auditId, {
        succeeded: results.every((r) => r.ok),
        matchedCount: removed,
        output: results.filter((r) => !r.ok).map((r) => `${r.verb}: ${r.message}`).join("\n"),
      });

      if (results.length > 0 && results.every((r) => !r.ok)) {
        // Consistent with /dedup and /history/delete-batch: nothing was
        // removed and every verb was refused, so the status line says so.
        set.status = 500;
      }
      return { removed, results };
    },
    { body: verbListSchema }
  )
  .get("/dedup/preview", async () => await HistoryStore.duplicatePreview(20))
  .post(
    "/dedup",
    async ({ body, set }) => {
      // Revalidated against what the caller actually saw: history keeps
      // arriving, and dedup run against a newer database would delete entries
      // that were never previewed.
      const current = await HistoryStore.duplicatePreview(0);
      // Compared by fingerprint, not by count: a different duplicate set can
      // have the same removable total, and the count alone would wave through
      // a deletion of entries the user never previewed.
      if (body.expectedFingerprint !== current.fingerprint) {
        set.status = 409;
        return {
          message:
            "The duplicate set changed since it was previewed. Review the new scope and confirm again.",
          preview: current,
        };
      }

      const auditId = await AuditStore.begin({
        action: "dedup",
        profile: envConfig.PROFILE,
        matchedCount: current.removable,
      });
      const res = await AtuinCli.dedup();
      await AuditStore.complete(auditId, {
        succeeded: res.ok,
        output: (res.stdout || res.stderr).trim(),
      });
      if (!res.ok) {
        // A 2xx with success:false reads as "done" to anything that checks the
        // status line, including the browser helper.
        set.status = 500;
        return { message: (res.stderr || res.stdout).trim() || "Dedup failed." };
      }
      return { success: true, output: res.stdout.trim() };
    },
    { body: t.Object({ expectedFingerprint: t.String({ minLength: 1 }) }) }
  )
  .get("/audit", async () => await AuditStore.recent(100))
  .post("/sync", async ({ set }) => {
    const res = await AtuinCli.sync();
    if (!res.ok) {
      set.status = 502;
      return { message: (res.stderr || res.stdout).trim() || "Sync failed." };
    }
    return { success: true, output: res.stdout.trim() };
  })

  // ─── Sync-server admin (E2E-encrypted: counts only, never commands) ──────
  .get("/stats", async () => await StatsStore.getOverview())
  .get("/stats/hosts", async () => await StatsStore.getHostStats())
  .get("/stats/activity", async () => await StatsStore.getActivity())
  .get("/users", async () => await UserStore.findAll())
  .get(
    "/users/:id/delete-preview",
    async ({ params, set }) => {
      const preview = await UserStore.deletePreview(params.id);
      if (!preview) {
        set.status = 404;
        return { message: "User not found" };
      }
      return preview;
    },
    { params: t.Object({ id: t.Numeric() }) }
  )
  .delete(
    "/users/:id",
    async ({ params, body, set }) => {
      let outcome: Awaited<ReturnType<typeof UserStore.delete>>;
      try {
        outcome = await UserStore.delete(params.id, body.expectedScope);
      } catch (err) {
        // Only the deliberate rollback means "the scope moved". Catching every
        // error here would report a genuine database failure as a stale
        // preview and invite the operator to simply confirm again.
        if (!(err instanceof TransactionRollbackError)) throw err;
        set.status = 409;
        const fresh = await UserStore.deletePreview(params.id);
        return {
          message: "This account's data changed since it was previewed. Review and confirm again.",
          preview: fresh,
        };
      }
      if (outcome === "not-found") {
        set.status = 404;
        return { message: "User not found" };
      }
      return { success: true };
    },
    // t.Numeric rejects "12abc" and "" outright; parseInt accepted both.
    {
      params: t.Object({ id: t.Numeric() }),
      // Required. An optional scope is not a guard: omitting it skipped the
      // transaction-time recheck entirely and deleted the account, its
      // sessions and every synced record with nothing previewed. Callers
      // outside the UI must preview first too.
      body: t.Object({
        expectedScope: t.Object({
          sessions: t.Integer({ minimum: 0 }),
          records: t.Integer({ minimum: 0 }),
        }),
      }),
    }
  )
  .get("/sessions", async () => await SessionStore.findAll())
  .delete(
    "/sessions/:id",
    async ({ params, set }) => {
      const revoked = await SessionStore.revoke(params.id);
      if (!revoked) {
        set.status = 404;
        return { message: "Session not found" };
      }
      return { success: true };
    },
    // t.Numeric rejects "12abc" and "" outright; parseInt accepted both.
    { params: t.Object({ id: t.Numeric() }) }
  );
