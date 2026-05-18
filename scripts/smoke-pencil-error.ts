const sensitiveKeyPattern =
  "access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|api[-_]?key|token|secret|password|passwd|authorization|cookie|session[-_]?id|session|account[-_]?id|account|email|username|user[-_]?id|user|login";
const sensitiveAssignmentPattern = new RegExp(
  `(["']?)\\b(${sensitiveKeyPattern})\\b\\1\\s*[:=]\\s*("[^"]*"|'[^']*'|[^\\s,;]+)`,
  "gi"
);

export function formatGenericErrorForLog(error: unknown): string {
  const exitCode = getExitCode(error);
  if (typeof exitCode === "number") {
    return `Unexpected error: command failed (exitCode=${exitCode})`;
  }

  return `Unexpected error: ${sanitizeGenericErrorForLog(error)}`;
}

export function sanitizeGenericErrorForLog(error: unknown): string {
  const message = rawErrorMessage(error);
  const withoutAnsi = message.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  const redacted = redactSensitiveFields(withoutAnsi);
  const oneLine = redacted.replace(/\s+/g, " ").trim();
  const fallback = oneLine.length > 0 ? oneLine : "Unknown failure";
  return fallback.length > 180 ? `${fallback.slice(0, 177)}...` : fallback;
}

function redactSensitiveFields(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .replace(sensitiveAssignmentPattern, (_match, quote: string, key: string) =>
      quote ? `${quote}${key}${quote}=<redacted>` : `${key}=<redacted>`
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>");
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function getExitCode(error: unknown): number | undefined {
  if (isRecord(error) && typeof error.exitCode === "number") {
    return error.exitCode;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
