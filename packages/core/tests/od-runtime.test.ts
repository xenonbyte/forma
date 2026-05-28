import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOdRuntime,
  type OdRuntime,
  type OdRuntimeInput,
  type OdRuntimeOutput,
} from '../src/od-runtime.js';
import { FormaError } from '../src/errors.js';
import { type ArtifactManifest } from '../src/artifact-manifest.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

// Minimal valid PNG magic bytes (just the signature, not a real image).
const pngMagic = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const validManifestFixture: ArtifactManifest = {
  version: 1,
  id: 'AbCdEfGhIjKlMnOp',
  kind: 'html',
  renderer: 'html',
  title: 'Test Artifact',
  entry: 'index.html',
  status: 'complete',
  exports: ['html'],
  createdAt: '2026-05-28T00:00:00.000Z',
  updatedAt: '2026-05-28T00:00:00.000Z',
};

const validInput: OdRuntimeInput = {
  kind: 'html',
  sourceSkillId: 'fm-design',
};

function makeSuccessfulOutput(): OdRuntimeOutput {
  return {
    manifest: { ...validManifestFixture },
    supportingFiles: new Map<string, Uint8Array>([
      ['index.html', encoder.encode('<h1>test</h1>')],
      ['preview/2x.png', pngMagic],
      ['preview/1x.png', pngMagic],
    ]),
  };
}

// ─── Env isolation helpers ────────────────────────────────────────────────────

let savedRuntimeEnv: string | undefined;
let savedTimeoutEnv: string | undefined;

beforeEach(() => {
  savedRuntimeEnv = process.env.FORMA_OD_RUNTIME;
  savedTimeoutEnv = process.env.FORMA_OD_RUNTIME_TIMEOUT_MS;
  delete process.env.FORMA_OD_RUNTIME;
  delete process.env.FORMA_OD_RUNTIME_TIMEOUT_MS;
});

afterEach(() => {
  if (savedRuntimeEnv !== undefined) {
    process.env.FORMA_OD_RUNTIME = savedRuntimeEnv;
  } else {
    delete process.env.FORMA_OD_RUNTIME;
  }
  if (savedTimeoutEnv !== undefined) {
    process.env.FORMA_OD_RUNTIME_TIMEOUT_MS = savedTimeoutEnv;
  } else {
    delete process.env.FORMA_OD_RUNTIME_TIMEOUT_MS;
  }
});

// ─── Step 1: happy path with injected main ────────────────────────────────────

describe('Step 1 — happy path with injected main', () => {
  it('generates artifact when main runtime resolves', async () => {
    const output = makeSuccessfulOutput();
    const mockMain: OdRuntime = {
      generate: vi.fn().mockResolvedValue(output),
    };
    const runtime = createOdRuntime({ main: mockMain });

    const result = await runtime.generate(validInput);

    expect(result.manifest.kind).toBe('html');
    expect(result.supportingFiles.has('preview/2x.png')).toBe(true);
    expect(result.supportingFiles.has('preview/1x.png')).toBe(true);
  });
});

// ─── Step 2: OD_RUNTIME_FAILED wrapping ───────────────────────────────────────

describe('Step 2 — OD_RUNTIME_FAILED wrapping', () => {
  it('wraps non-FormaError from main in OD_RUNTIME_FAILED with reason runtime_error', async () => {
    const mockMain: OdRuntime = {
      generate: vi.fn().mockRejectedValue(new Error('something exploded')),
    };
    const runtime = createOdRuntime({ main: mockMain });

    await expect(runtime.generate(validInput)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return (
        err.code === 'OD_RUNTIME_FAILED' &&
        err.details['reason'] === 'runtime_error'
      );
    });
  });

  it('passes FormaError from main through unchanged', async () => {
    const originalError = new FormaError('ARTIFACT_NOT_FOUND', 'test passthrough', { x: 1 });
    const mockMain: OdRuntime = {
      generate: vi.fn().mockRejectedValue(originalError),
    };
    const runtime = createOdRuntime({ main: mockMain });

    await expect(runtime.generate(validInput)).rejects.toSatisfy((err: unknown) => {
      return err === originalError;
    });
  });
});

// ─── Step 3: OD_RUNTIME_TIMEOUT ───────────────────────────────────────────────

describe('Step 3 — OD_RUNTIME_TIMEOUT', () => {
  it('throws OD_RUNTIME_TIMEOUT when main never resolves within timeout', async () => {
    process.env.FORMA_OD_RUNTIME_TIMEOUT_MS = '50';

    const neverResolves: OdRuntime = {
      generate: vi.fn().mockReturnValue(new Promise<OdRuntimeOutput>(() => {})),
    };
    const runtime = createOdRuntime({ main: neverResolves });

    await expect(runtime.generate(validInput)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === 'OD_RUNTIME_TIMEOUT';
    });
  }, 3000);
});

// ─── Step 4: No auto-fallback ─────────────────────────────────────────────────

describe('Step 4 — No auto-fallback', () => {
  it('propagates error from main without retrying with fallback', async () => {
    process.env.FORMA_OD_RUNTIME = 'main';

    const mockFallback: OdRuntime = {
      generate: vi.fn().mockResolvedValue(makeSuccessfulOutput()),
    };
    const mockMain: OdRuntime = {
      generate: vi.fn().mockRejectedValue(new Error('main failed')),
    };
    const runtime = createOdRuntime({ main: mockMain, fallback: mockFallback });

    await expect(runtime.generate(validInput)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return err.code === 'OD_RUNTIME_FAILED';
    });

    expect(mockMain.generate).toHaveBeenCalledOnce();
    expect(mockFallback.generate).not.toHaveBeenCalled();
  });
});

// ─── Step 5: Dispatch layer ───────────────────────────────────────────────────

describe('Step 5 — Dispatch layer', () => {
  it('routes to mockMain when FORMA_OD_RUNTIME=main', async () => {
    process.env.FORMA_OD_RUNTIME = 'main';

    const mockMain: OdRuntime = {
      generate: vi.fn().mockResolvedValue(makeSuccessfulOutput()),
    };
    const runtime = createOdRuntime({ main: mockMain });

    await runtime.generate(validInput);

    expect(mockMain.generate).toHaveBeenCalledOnce();
  });

  it('throws OD_RUNTIME_FAILED with reason fallback_not_implemented when FORMA_OD_RUNTIME=fallback and no custom fallback provided', async () => {
    process.env.FORMA_OD_RUNTIME = 'fallback';

    const runtime = createOdRuntime();

    await expect(runtime.generate(validInput)).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof FormaError)) return false;
      return (
        err.code === 'OD_RUNTIME_FAILED' &&
        err.details['reason'] === 'fallback_not_implemented'
      );
    });
  });

  it('routes to mockFallback when FORMA_OD_RUNTIME=fallback and custom fallback provided', async () => {
    process.env.FORMA_OD_RUNTIME = 'fallback';

    const mockFallback: OdRuntime = {
      generate: vi.fn().mockResolvedValue(makeSuccessfulOutput()),
    };
    const runtime = createOdRuntime({ fallback: mockFallback });

    await runtime.generate(validInput);

    expect(mockFallback.generate).toHaveBeenCalledOnce();
  });

  it('routes to mockMain when FORMA_OD_RUNTIME=unknown_value (unrecognized)', async () => {
    process.env.FORMA_OD_RUNTIME = 'unknown_value';

    const mockMain: OdRuntime = {
      generate: vi.fn().mockResolvedValue(makeSuccessfulOutput()),
    };
    const runtime = createOdRuntime({ main: mockMain });

    await runtime.generate(validInput);

    expect(mockMain.generate).toHaveBeenCalledOnce();
  });

  it('routes to mockMain when FORMA_OD_RUNTIME is not set', async () => {
    // env var already deleted in beforeEach
    const mockMain: OdRuntime = {
      generate: vi.fn().mockResolvedValue(makeSuccessfulOutput()),
    };
    const runtime = createOdRuntime({ main: mockMain });

    await runtime.generate(validInput);

    expect(mockMain.generate).toHaveBeenCalledOnce();
  });
});
