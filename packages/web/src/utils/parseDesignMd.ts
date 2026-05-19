export interface ParsedDesignMd {
  colors: Record<string, string>;
  typography: Record<string, string>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
  components: Record<string, Record<string, string>>;
  warnings: string[];
}

type FlatSection = "colors" | "typography" | "rounded" | "spacing";
type Section = FlatSection | "components";

const supportedSections = new Set<Section>(["colors", "typography", "rounded", "spacing", "components"]);
const keyPattern = /^[A-Za-z0-9_.-]+$/;
const tokenReferencePattern = /^\{[A-Za-z0-9_.-]+\}$/;

export function parseDesignMd(content: string): ParsedDesignMd {
  const parsed = emptyParsedDesignMd();
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);

  if (!/^---\s*$/.test(lines[0] ?? "")) {
    return parsed;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  if (closingIndex === -1) {
    parsed.warnings.push("Skipped DESIGN.md frontmatter: missing closing delimiter.");
    return parsed;
  }

  parseFrontmatterLines(lines.slice(1, closingIndex), parsed);
  return parsed;
}

function emptyParsedDesignMd(): ParsedDesignMd {
  return {
    colors: {},
    typography: {},
    rounded: {},
    spacing: {},
    components: {},
    warnings: []
  };
}

function parseFrontmatterLines(lines: string[], parsed: ParsedDesignMd): void {
  let currentSection: Section | undefined;
  let currentComponent: string | undefined;
  let currentTypographyToken: string | undefined;
  let skipChildrenOfIndent: number | undefined;

  lines.forEach((line, index) => {
    const lineNumber = index + 2;
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return;
    }

    const indentText = leadingWhitespace(line);
    const indent = indentText.length;
    if (skipChildrenOfIndent !== undefined) {
      if (indent > skipChildrenOfIndent) {
        return;
      }
      skipChildrenOfIndent = undefined;
    }

    if (indentText.includes("\t") || indent % 2 !== 0) {
      warn(parsed, lineNumber, "unsupported indentation", trimmed);
      return;
    }

    const level = indent / 2;
    if (level > 2) {
      warn(parsed, lineNumber, "unsupported nesting", trimmed);
      return;
    }

    if (trimmed.startsWith("-")) {
      warn(parsed, lineNumber, "array item", trimmed);
      return;
    }

    const lineMatch = /^([^:]+):(?:\s*(.*))?$/.exec(trimmed);
    const key = lineMatch?.[1]?.trim();
    if (!lineMatch || !key || !keyPattern.test(key)) {
      warn(parsed, lineNumber, "unsupported line", trimmed);
      return;
    }

    const rawValue = lineMatch[2]?.trim() ?? "";

    if (level === 0) {
      currentComponent = undefined;
      currentTypographyToken = undefined;
      if (!supportedSections.has(key as Section)) {
        currentSection = undefined;
        return;
      }

      currentSection = key as Section;
      if (rawValue.length > 0) {
        warn(parsed, lineNumber, `unsupported ${key} section value`, key);
        skipChildrenOfIndent = indent;
      }
      return;
    }

    if (!currentSection) {
      return;
    }

    if (level === 1) {
      currentComponent = undefined;
      currentTypographyToken = undefined;

      if (currentSection === "components") {
        if (rawValue.length > 0) {
          warn(parsed, lineNumber, "unsupported component value", key);
          skipChildrenOfIndent = indent;
          return;
        }

        currentComponent = key;
        parsed.components[key] ??= {};
        return;
      }

      if (currentSection === "typography" && rawValue.length === 0) {
        currentTypographyToken = key;
        return;
      }

      const value = readScalar(rawValue, key, lineNumber, parsed);
      if (value.status === "parsed") {
        parsed[currentSection][key] = value.value;
      } else {
        skipChildrenOfIndent = value.skipChildren ? indent : skipChildrenOfIndent;
      }
      return;
    }

    if (currentSection === "typography" && currentTypographyToken) {
      const value = readScalar(rawValue, key, lineNumber, parsed);
      if (key === "fontFamily" && value.status === "parsed") {
        parsed.typography[currentTypographyToken] = value.value;
      } else if (value.status === "skipped" && value.skipChildren) {
        skipChildrenOfIndent = indent;
      }
      return;
    }

    if (currentSection !== "components" || !currentComponent) {
      warn(parsed, lineNumber, "unsupported nested value", key);
      skipChildrenOfIndent = indent;
      return;
    }

    const value = readScalar(rawValue, key, lineNumber, parsed);
    if (value.status === "parsed") {
      parsed.components[currentComponent]![key] = value.value;
    } else {
      skipChildrenOfIndent = value.skipChildren ? indent : skipChildrenOfIndent;
    }
  });
}

function leadingWhitespace(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match?.[0] ?? "";
}

type ScalarResult = { status: "parsed"; value: string } | { skipChildren: boolean; status: "skipped" };

function readScalar(rawValue: string, key: string, lineNumber: number, parsed: ParsedDesignMd): ScalarResult {
  if (rawValue.length === 0) {
    warn(parsed, lineNumber, "complex structure", key);
    return { skipChildren: true, status: "skipped" };
  }

  if (rawValue.startsWith("|") || rawValue.startsWith(">")) {
    warn(parsed, lineNumber, "block scalar", key);
    return { skipChildren: true, status: "skipped" };
  }

  if (rawValue.startsWith("[") || rawValue.startsWith("-")) {
    warn(parsed, lineNumber, "array value", key);
    return { skipChildren: false, status: "skipped" };
  }

  if (rawValue.startsWith("{") || rawValue.endsWith("}")) {
    if (tokenReferencePattern.test(rawValue)) {
      return { status: "parsed", value: rawValue };
    }

    warn(parsed, lineNumber, "complex inline structure", key);
    return { skipChildren: false, status: "skipped" };
  }

  const quote = rawValue[0];
  if (quote === '"' || quote === "'") {
    if (!rawValue.endsWith(quote) || rawValue.length === 1) {
      warn(parsed, lineNumber, "multiline string", key);
      return { skipChildren: true, status: "skipped" };
    }

    return { status: "parsed", value: unquote(rawValue, quote) };
  }

  return { status: "parsed", value: rawValue };
}

function unquote(value: string, quote: string): string {
  const inner = value.slice(1, -1);
  if (quote === "'") {
    return inner.replace(/\\'/g, "'");
  }

  return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function warn(parsed: ParsedDesignMd, lineNumber: number, reason: string, keyOrLine: string): void {
  parsed.warnings.push(`Line ${lineNumber}: skipped ${keyOrLine} (${reason}).`);
}
