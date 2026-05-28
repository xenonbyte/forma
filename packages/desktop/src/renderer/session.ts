export interface SessionInfo {
  port: number;
  token: string;
  pid: number;
}

export type SessionResult =
  | { ok: true; session: SessionInfo }
  | { ok: false; reason: 'missing' | 'invalid' | 'unreachable' };

export const FORMA_DEFAULT_PORT = 14153;
export const HEALTH_CHECK_PATH = '/api/health';
export const MAX_RETRY_ATTEMPTS = 5;
export const RETRY_INTERVAL_MS = 5000;
export const RECONNECT_TIMEOUT_MS = 30000;

// Parse session.yaml content (simple YAML — just key: value lines)
export function parseSessionYaml(content: string): SessionInfo | null {
  const lines = content.split('\n');
  const map: Record<string, string> = {};
  for (const line of lines) {
    const match = /^(\w+):\s*(.+)$/.exec(line.trim());
    if (match) map[match[1]] = match[2].trim();
  }
  const pid = parseInt(map['pid'] ?? '', 10);
  const token = map['token'] ?? '';
  if (!pid || !token) return null;
  return { port: FORMA_DEFAULT_PORT, token, pid };
}

// Health check (accepts fetch as injectable dep for testing)
export async function checkServerHealth(
  port: number,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchFn(`http://localhost:${port}${HEALTH_CHECK_PATH}`);
    return res.ok;
  } catch {
    return false;
  }
}
