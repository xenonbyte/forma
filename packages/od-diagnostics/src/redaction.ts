const SENSITIVE_KEY_RE = /token|password|secret|key|dsn|authorization|cookie/i;

const URL_QUERY_SECRET_RE =
  /([?&#])(token|password|secret|key|dsn|api[_-]?key|auth|access_token|refresh_token|id_token)(=)([^&\s#"']*)/gi;

// Catch loose key=value pairs in log lines that aren't inside a URL — e.g. env
// dumps, command-line args, or json-line meta. The leading boundary stops it
// from matching mid-identifier (e.g. `not_a_token`). Order alternatives long-
// first so `access_token` wins over `token`.
const BARE_SECRET_RE =
  /(^|[\s,;])(access_token|refresh_token|id_token|api[_-]?key|password|secret|token|auth(?:orization)?)(=|:\s*)([^\s,;"']+)/gi;

// Bearer / Token / Basic auth schemes embed the secret after the scheme
// keyword, so the BARE pattern above stops at the space before `Bearer` and
// leaves the actual credential exposed. This pattern matches the scheme +
// credential as one unit. Case-insensitive: HTTP auth schemes are
// case-insensitive per RFC 7235 §2.1, and we routinely see lowercase
// `authorization: bearer …` in proxy / curl-style logs.
// Character class covers RFC 6750 token68 (ALPHA / DIGIT / "-" / "." / "_"
// / "~" / "+" / "/" / "=") plus ":" for Basic credentials. Missing "~"
// previously left tokens like `Bearer abcd~efgh` partially exposed.
const HTTP_AUTH_SCHEME_RE = /\b(Bearer|Token|Basic)\s+([A-Za-z0-9._~\-+/=:]{4,})/gi;

// YAML credential lines: `  api_key: "…"` / `authorization: …`. media-config.yaml
// stores the provider key as a YAML mapping value, so the JSON-only paths above
// never reach it — this catches the raw YAML form too. The value (quoted or
// bare) is replaced, the indentation + key are preserved so the surrounding
// config stays legible. Anchored to line start so it cannot match mid-line.
const YAML_SECRET_LINE_RE =
  /^(\s*)(api[_-]?key|authorization|secret|password|token)(\s*:\s*)("[^"]*"|'[^']*'|[^\s#].*)$/gim;

const REDACTED = "[REDACTED]";

// Files whose ENTIRE content is credential material and must never be bundled
// raw into a diagnostics export. media-config.yaml holds the provider api_key
// (SCOPE-IN-008 red line). Matched by basename so any path depth is covered.
const SENSITIVE_CONFIG_BASENAMES = new Set(["media-config.yaml"]);

/**
 * True when a zip entry / source name refers to a file whose whole content is
 * credential material (currently media-config.yaml). Diagnostics collectors use
 * this to exclude such files from the export entirely rather than relying on
 * line-level redaction alone.
 */
export function isSensitiveConfigFile(name: string): boolean {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  return SENSITIVE_CONFIG_BASENAMES.has(base);
}

export interface RedactionOptions {
  username?: string | undefined;
}

export function redactJsonValue(value: unknown, opts: RedactionOptions = {}): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactJsonValue(entry, opts));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key) && typeof raw === "string" && raw.length > 0) {
        out[key] = REDACTED;
      } else {
        out[key] = redactJsonValue(raw, opts);
      }
    }
    return out;
  }
  if (typeof value === "string") return redactText(value, opts);
  return value;
}

export function redactText(text: string, opts: RedactionOptions = {}): string {
  // Run the HTTP auth scheme replacement first so the credential after
  // `Bearer` / `Token` / `Basic` is captured before BARE_SECRET_RE swallows
  // the `Authorization: Bearer` prefix and stops at the space.
  let out = text.replace(HTTP_AUTH_SCHEME_RE, (_match, scheme) => `${scheme} ${REDACTED}`);
  out = out.replace(URL_QUERY_SECRET_RE, (_match, sep, name, eq) => `${sep}${name}${eq}${REDACTED}`);
  // YAML credential lines before BARE: BARE_SECRET_RE only matches `key=value`
  // / `key: value` with no leading whitespace boundary inside a line, so the
  // indented YAML form (`    api_key: "…"`) would otherwise slip through.
  out = out.replace(YAML_SECRET_LINE_RE, (_match, indent, name, sep) => `${indent}${name}${sep}${REDACTED}`);
  out = out.replace(BARE_SECRET_RE, (_match, lead, name, sep) => `${lead}${name}${sep}${REDACTED}`);
  const username = opts.username;
  if (username && username.length > 1) {
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`/Users/${escaped}(?=[/"\\s])`, "g"), "/Users/<USER>");
    out = out.replace(new RegExp(`\\\\Users\\\\${escaped}(?=[\\\\"\\s])`, "g"), "\\Users\\<USER>");
    out = out.replace(new RegExp(`/home/${escaped}(?=[/"\\s])`, "g"), "/home/<USER>");
  }
  return out;
}

export function redactJsonText(text: string, opts: RedactionOptions = {}): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return redactText(text, opts);
  }
  return JSON.stringify(redactJsonValue(parsed, opts), null, 2);
}
