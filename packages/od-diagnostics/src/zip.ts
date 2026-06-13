import JSZip from "jszip";

import { isSensitiveConfigFile, redactJsonValue, type RedactionOptions } from "./redaction.js";
import {
  buildManifest,
  buildMachineInfo,
  type DiagnosticsContext,
  type DiagnosticsManifest,
  type MachineInfo,
} from "./manifest.js";
import {
  collectLogSources,
  findMacOSCrashReports,
  type CollectedFile,
  type CrashReportLookup,
  type LogSource,
} from "./sources.js";

const PLACEHOLDER_PREFIX = "; file unavailable: ";

// Marker written in place of a credential file's bytes. The raw content (e.g.
// media-config.yaml provider api_key) is never read into the zip — only this
// masked-metadata placeholder appears. SCOPE-IN-008 red line.
const EXCLUDED_PLACEHOLDER = "; file excluded: contains credentials, content omitted from diagnostics\n";

export interface DiagnosticsExportInput {
  context: DiagnosticsContext;
  sources: LogSource[];
  redaction?: RedactionOptions;
  /** When provided, scan macOS crash reports matching these substrings. */
  crashReports?: CrashReportLookup;
}

export interface DiagnosticsExportResult {
  zip: Buffer;
  manifest: DiagnosticsManifest;
  machineInfo: MachineInfo;
}

function placeholderForMissing(file: CollectedFile): string {
  return `${PLACEHOLDER_PREFIX}${file.error ?? "unknown error"}\n`;
}

export async function buildDiagnosticsZip(input: DiagnosticsExportInput): Promise<DiagnosticsExportResult> {
  const redaction = input.redaction ?? {};
  const sources = [...input.sources];

  if (input.crashReports != null) {
    const crashes = await findMacOSCrashReports(input.crashReports);
    sources.push(...crashes);
  }

  // Partition off credential files (e.g. media-config.yaml). Their bytes are
  // NEVER read or redacted — they are replaced wholesale with a placeholder so
  // no provider api_key can leak even through a redaction miss.
  const safeSources = sources.filter((source) => !isSensitiveConfigFile(source.name));
  const excludedSources = sources.filter((source) => isSensitiveConfigFile(source.name));

  const safeCollected = await collectLogSources(safeSources, redaction);
  const collected: CollectedFile[] = [
    ...safeCollected,
    ...excludedSources.map((source) => ({
      name: source.name,
      absolutePath: source.absolutePath,
      content: EXCLUDED_PLACEHOLDER,
      bytes: 0,
    })),
  ];
  const manifest = buildManifest(input.context, collected);
  const machineInfo = buildMachineInfo(redaction.username);

  const zip = new JSZip();
  for (const file of collected) {
    zip.file(file.name, file.content ?? placeholderForMissing(file));
  }
  zip.file("summary/manifest.json", JSON.stringify(redactJsonValue(manifest, redaction), null, 2));
  zip.file("summary/machine-info.json", JSON.stringify(redactJsonValue(machineInfo, redaction), null, 2));

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { zip: buffer, manifest, machineInfo };
}
