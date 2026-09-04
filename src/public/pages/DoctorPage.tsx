import React, { useCallback, useEffect, useState } from "react";
import { Stethoscope, CheckCircle2, AlertTriangle, XCircle, Download } from "lucide-react";
import { Skeleton } from "../components/Card";
import { getJson, postJson, errorMessage, isArray } from "../lib/http";
import { useToastStore } from "../stores/toast-store";

type CheckStatus = "ok" | "warn" | "fail";

interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  remedy?: "install-atuin" | "login";
}

interface DoctorReport {
  healthy: boolean;
  profile: string;
  checks: Check[];
}

const ICON: Record<CheckStatus, { Icon: typeof CheckCircle2; cls: string }> = {
  ok: { Icon: CheckCircle2, cls: "text-brand" },
  warn: { Icon: AlertTriangle, cls: "text-warn" },
  fail: { Icon: XCircle, cls: "text-danger" },
};

/**
 * Environment self-check.
 *
 * The dashboard depends on things it does not own — the atuin binary, the
 * client databases, a login session — so each is reported separately with the
 * specific next action rather than one opaque failure.
 */
export function DoctorPage() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const push = useToastStore((s) => s.push);

  const load = useCallback(() => {
    setError(null);
    getJson<DoctorReport>("/api/doctor", { expect: (v) => isArray((v as DoctorReport)?.checks) })
      .then(setReport)
      // Distinguished from "still checking": a null report renders an
      // indefinite skeleton, which looks identical to a hung request.
      .catch((err) => setError(errorMessage(err, "Could not run the checks")));
  }, []);

  useEffect(load, [load]);

  async function installAtuin() {
    setInstalling(true);
    try {
      // Validated: the version is the whole content of the toast, and an
      // absent one reads as "Installed atuin undefined".
      const body = await postJson<{ version: string }>("/api/doctor/install-atuin", {}, {
        expect: (v) => typeof (v as { version?: unknown })?.version === "string",
      });
      push("success", `Installed atuin ${body.version}`);
      load();
    } catch (err) {
      push("error", errorMessage(err, "Install failed."));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Stethoscope size={22} className="text-ink-muted" />
          Doctor
        </h1>
        <p className="text-ink-muted text-sm mt-1">
          {report
            ? report.healthy
              ? "Everything the dashboard needs is present."
              : "Something required is missing — see below."
            : "Checking…"}
        </p>
      </header>

      {error && (
        <p className="text-danger text-sm bg-danger-soft border border-danger/30 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {!report && !error && <Skeleton height={220} />}

      <div className="space-y-2">
        {report?.checks.map((check) => {
          // Fallback: an unknown status from a newer server would otherwise
          // destructure undefined and blank the page.
          const { Icon, cls } = ICON[check.status] ?? ICON.warn;
          return (
            <div
              key={check.id}
              className="flex items-start gap-3 rounded-xl border border-line bg-raised px-4 py-3"
            >
              <Icon size={16} className={`${cls} shrink-0 mt-0.5`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{check.label}</p>
                <p className="text-xs text-ink-muted mt-0.5 break-words">{check.detail}</p>
              </div>
              {check.remedy === "install-atuin" && (
                <button
                  onClick={installAtuin}
                  disabled={installing}
                  className="inline-flex items-center gap-1.5 shrink-0 rounded-lg border border-brand/40 bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand disabled:opacity-50 hover:brightness-110"
                >
                  <Download size={13} />
                  {installing ? "Downloading…" : "Download"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-ink-subtle text-xs">
        The download is fetched from GitHub Releases and its published sha256 is verified
        before the binary is made executable. Pin a different release with{" "}
        <code className="font-mono">ATUIN_VERSION</code>, or point at an existing binary with{" "}
        <code className="font-mono">ATUIN_BIN</code>.
      </p>
    </div>
  );
}
