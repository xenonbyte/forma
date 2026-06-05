import { parseDesignMd, type ParsedDesignMd } from "./parseDesignMd.js";

export interface StyleVisualTokens {
  backgroundColor?: string;
  fontFamily?: string;
  primaryColor?: string;
  secondaryColor?: string;
  textColor?: string;
}

export interface ExtractStyleVisualTokensInput {
  designMd?: string;
  tokensCss?: string;
}

export function extractStyleVisualTokens({
  designMd = "",
  tokensCss = "",
}: ExtractStyleVisualTokensInput): StyleVisualTokens {
  const parsed = parseDesignMd(designMd);
  const cssVars = parseCssVariables(tokensCss);

  return compactVisualTokens({
    backgroundColor: safeCssColor(
      firstResolved(
        [
          pick(parsed.colors, ["background", "canvas", "surface", "page", "app-background", "bg"]),
          pickCssVar(cssVars, [
            "--background",
            "--color-background",
            "--canvas",
            "--color-canvas",
            "--surface",
            "--color-surface",
            "--page-background",
          ]),
        ],
        parsed,
        cssVars,
      ),
    ),
    fontFamily: safeFontFamily(
      firstResolved(
        [
          pick(parsed.typography, [
            "font-body",
            "body",
            "body-md",
            "body-lg",
            "font-heading",
            "heading",
            "heading-md",
            "display",
          ]),
          pickByName(parsed.typography, ["body", "heading", "display"]),
          pickCssVar(cssVars, [
            "--font-body",
            "--font-family-body",
            "--body-font",
            "--font-sans",
            "--font-heading",
            "--font-family-heading",
          ]),
        ],
        parsed,
        cssVars,
      ),
    ),
    primaryColor: safeCssColor(
      firstResolved(
        [
          pick(parsed.colors, ["primary", "brand", "accent", "action"]),
          pickCssVar(cssVars, [
            "--primary",
            "--color-primary",
            "--brand",
            "--color-brand",
            "--accent",
            "--color-accent",
            "--action",
          ]),
        ],
        parsed,
        cssVars,
      ),
    ),
    secondaryColor: safeCssColor(
      firstResolved(
        [
          pick(parsed.colors, ["secondary", "accent-secondary", "support", "muted-accent"]),
          pickCssVar(cssVars, [
            "--secondary",
            "--color-secondary",
            "--accent-secondary",
            "--color-accent-secondary",
            "--support",
            "--muted-accent",
          ]),
        ],
        parsed,
        cssVars,
      ),
    ),
    textColor: safeCssColor(
      firstResolved(
        [
          pick(parsed.colors, ["text-primary", "text", "foreground", "ink", "body", "content"]),
          pickCssVar(cssVars, [
            "--text-primary",
            "--color-text-primary",
            "--text",
            "--color-text",
            "--foreground",
            "--color-foreground",
            "--ink",
            "--color-ink",
          ]),
        ],
        parsed,
        cssVars,
      ),
    ),
  });
}

function parseCssVariables(css: string): Record<string, string> {
  const variables: Record<string, string> = {};
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const variablePattern = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;

  while ((match = variablePattern.exec(withoutComments))) {
    const name = match[1]?.trim();
    const value = match[2]?.trim();
    if (name && value) {
      variables[name] = value;
    }
  }

  return variables;
}

function compactVisualTokens(tokens: StyleVisualTokens): StyleVisualTokens {
  return Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined)) as StyleVisualTokens;
}

function firstResolved(
  values: Array<string | undefined>,
  parsed: ParsedDesignMd,
  cssVars: Record<string, string>,
): string | undefined {
  for (const value of values) {
    const resolved = resolveValue(value, parsed, cssVars, new Set());
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function resolveValue(
  value: string | undefined,
  parsed: ParsedDesignMd,
  cssVars: Record<string, string>,
  seen: Set<string>,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const token = tokenReference(trimmed);
  if (token) {
    if (seen.has(token)) {
      return undefined;
    }
    seen.add(token);
    return resolveValue(rawTokenValue(token, parsed, cssVars), parsed, cssVars, seen);
  }

  const cssVariable = cssVariableReference(trimmed);
  if (cssVariable) {
    if (seen.has(cssVariable.name)) {
      return resolveValue(cssVariable.fallback, parsed, cssVars, seen);
    }
    seen.add(cssVariable.name);
    return resolveValue(cssVars[cssVariable.name] ?? cssVariable.fallback, parsed, cssVars, seen);
  }

  return trimmed;
}

function rawTokenValue(token: string, parsed: ParsedDesignMd, cssVars: Record<string, string>): string | undefined {
  if (token.startsWith("colors.")) {
    return parsed.colors[token.slice("colors.".length)];
  }
  if (token.startsWith("typography.")) {
    return parsed.typography[token.slice("typography.".length)];
  }
  if (token.startsWith("--")) {
    return cssVars[token];
  }

  return undefined;
}

function tokenReference(value: string): string | undefined {
  const match = /^\{([A-Za-z0-9_.-]+|--[A-Za-z0-9_-]+)\}$/.exec(value);
  return match?.[1];
}

function cssVariableReference(value: string): { fallback?: string; name: string } | undefined {
  const match = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value);
  if (!match?.[1]) {
    return undefined;
  }

  return { name: match[1], fallback: match[2]?.trim() };
}

function pick(record: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function pickByName(record: Record<string, string>, fragments: string[]): string | undefined {
  const entry = Object.entries(record).find(
    ([key, value]) => value.trim().length > 0 && fragments.some((fragment) => key.toLowerCase().includes(fragment)),
  );
  return entry?.[1];
}

function pickCssVar(variables: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = variables[name]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function safeCssColor(value: string | undefined): string | undefined {
  const trimmed = safeCssValue(value);
  if (!trimmed) {
    return undefined;
  }

  if (
    /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ||
    /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([^)]+\)$/.test(trimmed) ||
    /^(?:black|white|transparent|currentColor)$/i.test(trimmed)
  ) {
    return trimmed;
  }

  return undefined;
}

function safeFontFamily(value: string | undefined): string | undefined {
  const trimmed = safeCssValue(value);
  if (!trimmed || !/^[A-Za-z0-9\s"',.-]+$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function safeCssValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 120 || /[;{}<>]/.test(trimmed) || /url\s*\(/i.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}
