/**
 * Dispatch layer for the open-design artifact generation runtime.
 * SPEC-IF-OD-001: OdRuntime interface and createOdRuntime factory.
 *
 * Preview generation contract (enforced in real runtime, not in stubs):
 * - supportingFiles must contain 'preview/2x.png' and 'preview/1x.png'
 * - Generation ORDER: 2x first, then 1x (2x can be source for 1x downscale)
 */

import { type ArtifactKind, type ArtifactManifest } from './artifact-manifest.js';
import { FormaError } from './errors.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface OdRuntimeInput {
  kind: ArtifactKind;
  requirementId?: string;
  designSystemId?: string;
  instructions?: string;
  sourceSkillId: string;
  style?: string;
  platform?: string;
  language?: string;
  /** Set true to bypass internal caches and force a full rebuild. */
  ignoreInternalCache?: boolean;
}

export interface OdRuntimeOutput {
  manifest: ArtifactManifest;
  /**
   * All supporting files keyed by relative path.
   * Must include 'preview/2x.png' and 'preview/1x.png' (real runtime only).
   */
  supportingFiles: Map<string, Uint8Array>;
}

export interface OdRuntime {
  generate(input: OdRuntimeInput): Promise<OdRuntimeOutput>;
}

// ─── Stub runtimes ────────────────────────────────────────────────────────────

/**
 * mainOdRuntime — stub.
 * Full od-plugin-runtime wiring is deferred to a later integration task.
 */
export const mainOdRuntime: OdRuntime = {
  async generate(_input: OdRuntimeInput): Promise<OdRuntimeOutput> {
    // Integration with od-plugin-runtime is wired in a later task.
    throw new FormaError('OD_RUNTIME_FAILED', 'od-plugin-runtime main path not yet wired', {
      cause: 'main_path_stub',
      reason: 'pending_integration',
    });
  },
};

/**
 * fallbackOdRuntime — stub.
 * A-05 spike passed; fallback is permanently deferred.
 */
const fallbackOdRuntime: OdRuntime = {
  async generate(_input: OdRuntimeInput): Promise<OdRuntimeOutput> {
    throw new FormaError('OD_RUNTIME_FAILED', 'fallback not implemented', {
      cause: 'stub',
      reason: 'fallback_not_implemented',
    });
  },
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * createOdRuntime — dispatch factory.
 *
 * Reads FORMA_OD_RUNTIME to select the runtime:
 *   - 'fallback' → use options.fallback ?? fallbackOdRuntime
 *   - anything else (incl. 'main', unrecognized, or unset) → use options.main ?? mainOdRuntime
 *
 * Wraps each call in a timeout from FORMA_OD_RUNTIME_TIMEOUT_MS (default 60 000 ms).
 * - Timeout → FormaError('OD_RUNTIME_TIMEOUT', ...)
 * - Non-FormaError → wrapped in FormaError('OD_RUNTIME_FAILED', ...)
 * - FormaError → passes through as-is
 *
 * @param options.main     TEST ONLY: override mainOdRuntime
 * @param options.fallback Optional custom fallback; defaults to fallbackOdRuntime (stub)
 */
export function createOdRuntime(options?: {
  main?: OdRuntime;
  fallback?: OdRuntime;
}): OdRuntime {
  return {
    async generate(input: OdRuntimeInput): Promise<OdRuntimeOutput> {
      const envRuntime = process.env.FORMA_OD_RUNTIME;
      const timeoutMs =
        parseInt(process.env.FORMA_OD_RUNTIME_TIMEOUT_MS ?? '', 10) || 60_000;

      const runtime =
        envRuntime === 'fallback'
          ? (options?.fallback ?? fallbackOdRuntime)
          : (options?.main ?? mainOdRuntime);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new FormaError(
              'OD_RUNTIME_TIMEOUT',
              `od-runtime timed out after ${timeoutMs}ms`,
              { timeoutMs, runtimeMode: envRuntime ?? 'main' },
            ),
          );
        }, timeoutMs);
        (timeoutHandle as NodeJS.Timeout).unref?.();
      });

      try {
        const result = await Promise.race([runtime.generate(input), timeoutPromise]);
        return result;
      } catch (err) {
        if (err instanceof FormaError) {
          throw err;
        }
        throw new FormaError('OD_RUNTIME_FAILED', 'od-runtime failed', {
          cause: String(err),
          reason: 'runtime_error',
        });
      } finally {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      }
    },
  };
}
