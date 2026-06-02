/**
 * Tailwind CSS 预处理器
 *
 * 功能：
 * 1. 检测 HTML 中的 Tailwind CSS Play CDN 使用
 * 2. 提取 Tailwind 配置和自定义样式
 * 3. 使用 Tailwind CSS API 编译生成完整 CSS
 * 4. 将生成的 CSS 注入 HTML，移除 CDN 脚本
 */

import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type { Config } from 'tailwindcss';
import autoprefixer from 'autoprefixer';

/**
 * Tailwind 预处理结果
 */
export interface TailwindPreprocessResult {
  /** 处理后的 HTML */
  html: string;
  /** 是否检测到 Tailwind CSS */
  hasTailwind: boolean;
  /** 生成的 CSS（如果有） */
  generatedCSS?: string;
}

type TailwindConfigObject = Record<string, unknown>;

/**
 * 检测 HTML 是否使用 Tailwind CSS Play CDN
 */
function detectTailwindCDN(html: string): boolean {
  return html.includes('cdn.tailwindcss.com');
}

function isRecord(value: unknown): value is TailwindConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将 JS 对象字面量（受限子集）转换为 JSON 字符串。
 * 注意：不执行任何代码；复杂表达式会在 JSON.parse 阶段失败并回退。
 */
function normalizeObjectLiteral(configLiteral: string): string {
  const withoutComments = configLiteral
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const withQuotedKeys = withoutComments.replace(
    /([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g,
    '$1"$2"$3'
  );

  const withDoubleQuotedStrings = withQuotedKeys.replace(
    /'([^'\\]*(?:\\.[^'\\]*)*)'/g,
    (_, value: string) => `"${value.replace(/\\"/g, '"').replace(/"/g, '\\"')}"`
  );

  return withDoubleQuotedStrings
    .replace(/\bundefined\b/g, 'null')
    .replace(/,\s*([}\]])/g, '$1');
}

function parseTailwindConfig(configLiteral: string): TailwindConfigObject | null {
  const normalized = normalizeObjectLiteral(configLiteral);

  try {
    const parsed: unknown = JSON.parse(normalized);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractBalancedObjectLiteral(source: string, openBraceIndex: number): string | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex, i + 1);
      }
    }
  }

  return null;
}

function extractTailwindConfigLiteral(content: string): string | null {
  const match = /tailwind\.config\s*=\s*/.exec(content);
  if (!match) {
    return null;
  }

  let openBraceIndex = match.index + match[0].length;
  while (openBraceIndex < content.length && /\s/.test(content[openBraceIndex])) {
    openBraceIndex += 1;
  }

  if (content[openBraceIndex] !== '{') {
    return null;
  }

  return extractBalancedObjectLiteral(content, openBraceIndex);
}

/**
 * 提取 Tailwind 配置
 */
function extractTailwindConfig(document: Document): Partial<Config> {
  const scripts = document.querySelectorAll('script');

  for (const script of scripts) {
    const content = script.textContent || '';
    if (!content.includes('tailwind.config')) {
      continue;
    }

    const configLiteral = extractTailwindConfigLiteral(content);
    if (!configLiteral) {
      continue;
    }

    const parsed = parseTailwindConfig(configLiteral);
    if (parsed) {
      return parsed as Partial<Config>;
    }

    console.warn('Failed to parse Tailwind config safely; fallback to default config.');
  }

  return {};
}

/**
 * 提取自定义 Tailwind 样式
 */
function extractCustomStyles(document: Document): string {
  let customStyles = '';
  const styleElements = document.querySelectorAll('style[type="text/tailwindcss"]');

  for (const style of styleElements) {
    customStyles += style.textContent || '';
    customStyles += '\n';
  }

  return customStyles;
}

/**
 * 收集 HTML 中使用的所有 class
 */
function collectClasses(document: Document): string[] {
  const classes = new Set<string>();
  const elements = document.querySelectorAll('[class]');

  for (const element of elements) {
    const classList = element.getAttribute('class') || '';
    for (const className of classList.split(/\s+/)) {
      if (className) {
        classes.add(className);
      }
    }
  }

  return Array.from(classes);
}

/**
 * 使用 Tailwind CSS API 编译生成 CSS
 */
async function compileTailwindCSS(
  config: Partial<Config>,
  customStyles: string,
  classes: string[]
): Promise<string> {
  const inputCSS = `
@tailwind base;
@tailwind components;
@tailwind utilities;

${customStyles}
`;

  const virtualHTML = `<div class="${classes.join(' ')}"></div>`;

  const tailwindConfig: Config = {
    ...(config as Config),
    content: [
      {
        raw: virtualHTML,
        extension: 'html',
      },
    ],
  };

  const result = await postcss([
    tailwindcss(tailwindConfig),
    autoprefixer(),
  ]).process(inputCSS, {
    from: undefined,
  });

  return result.css;
}

/**
 * 预处理 HTML，编译 Tailwind CSS
 */
export async function preprocessTailwindCSS(html: string): Promise<TailwindPreprocessResult> {
  if (!detectTailwindCDN(html)) {
    return {
      html,
      hasTailwind: false,
    };
  }

  const dom = new JSDOM(html);
  const document = dom.window.document;

  const config = extractTailwindConfig(document);
  const customStyles = extractCustomStyles(document);
  const classes = collectClasses(document);
  const generatedCSS = await compileTailwindCSS(config, customStyles, classes);

  const cdnScripts = document.querySelectorAll('script[src*="cdn.tailwindcss.com"]');
  for (const script of cdnScripts) {
    script.remove();
  }

  const configScripts = document.querySelectorAll('script');
  for (const script of configScripts) {
    const content = script.textContent || '';
    if (content.includes('tailwind.config')) {
      script.remove();
    }
  }

  const tailwindStyles = document.querySelectorAll('style[type="text/tailwindcss"]');
  for (const style of tailwindStyles) {
    style.remove();
  }

  const styleElement = document.createElement('style');
  styleElement.textContent = generatedCSS;

  if (document.head) {
    document.head.appendChild(styleElement);
  } else {
    const head = document.createElement('head');
    head.appendChild(styleElement);
    document.documentElement.insertBefore(head, document.body || null);
  }

  return {
    html: dom.serialize(),
    hasTailwind: true,
    generatedCSS,
  };
}
