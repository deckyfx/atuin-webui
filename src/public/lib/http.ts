/**
 * JSON helpers for the dashboard UI.
 *
 * `fetch()` resolves for 4xx and 5xx, so `fetch(u).then(r => r.json())` sets an
 * error payload as though it were data and the next render throws on a missing
 * field. That defect was fixed file-by-file twice and came back both times, so
 * the check lives here instead: pages call these and cannot forget it.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The parsed error payload, when the server sent one. Callers that treat
     *  a specific status as a normal outcome (409 with a fresh preview) need
     *  the body, not just the message. */
    readonly body?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Reads the server's `message` when it sends one, so errors stay specific. */
async function toError(res: Response): Promise<HttpError> {
  let message = `Request failed (${res.status})`;
  let body: unknown;
  try {
    body = await res.json();
    const m = (body as { message?: unknown })?.message;
    if (typeof m === "string" && m) message = m;
  } catch {
    // Not JSON, or empty: the status line is all we have.
  }
  return new HttpError(res.status, message, body);
}

export interface JsonOptions {
  signal?: AbortSignal;
  /** Rejects the payload when it is not the shape the caller expects. */
  expect?: (value: unknown) => boolean;
}

async function parse<T>(res: Response, options?: JsonOptions): Promise<T> {
  if (!res.ok) throw await toError(res);

  const body = (await res.json()) as unknown;
  if (options?.expect && !options.expect(body)) {
    throw new HttpError(res.status, "The server returned an unexpected response.");
  }
  return body as T;
}

export async function getJson<T>(url: string, options?: JsonOptions): Promise<T> {
  return parse<T>(await fetch(url, { signal: options?.signal }), options);
}

export async function postJson<T>(
  url: string,
  body?: unknown,
  options?: JsonOptions
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal,
  });
  return parse<T>(res, options);
}

/**
 * DELETE, optionally with a body.
 *
 * A body on DELETE is unusual but deliberate here: destructive endpoints take
 * the scope the caller confirmed against, so the server can refuse when it no
 * longer matches.
 */
export async function deleteJson<T>(
  url: string,
  body?: unknown,
  options?: JsonOptions
): Promise<T> {
  const res = await fetch(url, {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: options?.signal,
  });
  return parse<T>(res, options);
}

/** Narrows an unknown error to a message worth showing. */
export function errorMessage(err: unknown, fallback = "Request failed"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** True when a rejection is just an aborted request, not a failure to report. */
export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
export const hasNumber =
  (key: string) =>
  (v: unknown): boolean =>
    typeof (v as Record<string, unknown> | null)?.[key] === "number";
