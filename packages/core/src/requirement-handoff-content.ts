/**
 * requirement-handoff-content.ts
 *
 * Server-side decode of a handoff page's .vzi into a slim, JSON-serializable
 * shape the Web annotation canvas consumes. The VZI decoder is Node-only
 * (zlib brotli + node crypto + Buffer), so decoding happens here (core/server),
 * never in the browser.
 */
import { readFile } from 'node:fs/promises';
import { VZIDecoder } from '@vzi-core/format';
import { FormaError } from './errors.js';

export interface DecodedHandoffContent {
  /** content.metadata (e.g. formaViewport) */
  metadata: Record<string, unknown>;
  /** content.elements Map serialized as entries */
  elements: Array<[string, unknown]>;
  /** content.images Map serialized as entries */
  images: Array<[string, unknown]>;
}

export async function loadDecodedHandoffContent(vziPath: string): Promise<DecodedHandoffContent> {
  let bytes: Buffer;
  try {
    bytes = await readFile(vziPath);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new FormaError('ARTIFACT_NOT_FOUND', 'VZI file not found', { path: vziPath });
    }
    throw new FormaError('ARTIFACT_WRITE_FAIL', 'VZI file is unreadable', { path: vziPath, cause: err.message });
  }
  const decoder = new VZIDecoder({ enableErrorRecovery: true });
  let result: ReturnType<VZIDecoder['decode']>;
  try {
    result = decoder.decode(new Uint8Array(bytes));
  } catch (cause) {
    throw new FormaError('ARTIFACT_UNSUPPORTED_FORMAT', 'VZI decode failed', {
      path: vziPath,
      errors: [cause instanceof Error ? cause.message : String(cause)],
    });
  }
  const fatal = result.errors.filter((e) => e.fatal);
  if (fatal.length > 0) {
    throw new FormaError('ARTIFACT_UNSUPPORTED_FORMAT', 'VZI decode failed', {
      path: vziPath,
      errors: fatal.map((e) => e.message),
    });
  }
  const content = result.content;
  return {
    metadata: (content.metadata ?? {}) as unknown as Record<string, unknown>,
    elements: [...content.elements.entries()] as Array<[string, unknown]>,
    images: [...content.images.entries()] as Array<[string, unknown]>,
  };
}
