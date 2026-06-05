import type { IRElementType, IRStyles } from "@vzi-core/types";
import { IRElementType as ElementType } from "@vzi-core/types";

/**
 * CSS 变量（自定义属性）提取结果
 */
export interface CSSVariable {
  /** 变量名（包含 -- 前缀） */
  name: string;
  /** 变量值 */
  value: string;
  /** 变量定义位置的选择器（用于调试） */
  definedAt?: string;
}

/**
 * CSS 变量解析器
 * 负责提取和解析 CSS 自定义属性（var(--variable)）
 */
export class CSSVariableParser {
  private variables: Map<string, CSSVariable> = new Map();

  /**
   * 从 CSS 文本中提取变量定义
   * @param cssText CSS 文本内容
   * @param contextSelector 上下文选择器（用于记录定义位置）
   */
  extractFromCSS(cssText: string, contextSelector?: string): CSSVariable[] {
    const extracted: CSSVariable[] = [];

    // 匹配 --variable-name: value; 模式
    const variableRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);?/g;
    let match;

    while ((match = variableRegex.exec(cssText)) !== null) {
      const name = `--${match[1]}`;
      const value = match[2].trim();

      const variable: CSSVariable = {
        name,
        value,
        definedAt: contextSelector,
      };

      this.variables.set(name, variable);
      extracted.push(variable);
    }

    return extracted;
  }

  /**
   * 解析 var() 函数引用
   * @param value 包含 var() 的值
   * @returns 解析后的变量信息
   */
  parseVarReference(value: string): { variableName: string; fallback?: string } | null {
    // 匹配 var(--name) 或 var(--name, fallback)
    const varRegex = /var\s*\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\s*\)/;
    const match = varRegex.exec(value);

    if (!match) {
      return null;
    }

    return {
      variableName: match[1],
      fallback: match[2]?.trim(),
    };
  }

  /**
   * 解析样式值中的 CSS 变量引用
   * @param value 样式值
   * @returns 解析后的值（如果有变量则返回变量信息，否则返回原值）
   */
  parseStyleValue(
    value: string,
  ): { type: "literal"; value: string } | { type: "variable"; variable: CSSVariable; fallback?: string; raw: string } {
    const varInfo = this.parseVarReference(value);

    if (!varInfo) {
      return { type: "literal", value };
    }

    const variable = this.variables.get(varInfo.variableName);
    return {
      type: "variable",
      variable: variable || { name: varInfo.variableName, value: "" },
      fallback: varInfo.fallback,
      raw: value,
    };
  }

  /**
   * 解析样式值并替换 CSS 变量
   * @param value 原始样式值
   * @param resolvedValues 已解析的变量值映射
   * @returns 替换变量后的值
   */
  resolveValue(value: string, resolvedValues?: Map<string, string>): string {
    if (!value || !value.includes("var(")) {
      return value;
    }

    // 替换所有 var() 引用
    return value.replace(
      /var\s*\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\s*\)/g,
      (match: string, varName: string, fallback?: string) => {
        // 优先使用传入的解析值
        if (resolvedValues?.has(varName)) {
          const resolved = resolvedValues.get(varName);
          if (resolved) {
            return resolved;
          }
        }

        // 其次使用已提取的变量
        const variable = this.variables.get(varName);
        if (variable) {
          return variable.value;
        }

        // 最后使用 fallback
        if (fallback) {
          return fallback.trim();
        }

        // 无法解析，返回原始值
        return match;
      },
    );
  }

  /**
   * 获取所有已提取的变量
   */
  getVariables(): CSSVariable[] {
    return Array.from(this.variables.values());
  }

  /**
   * 获取指定变量
   */
  getVariable(name: string): CSSVariable | undefined {
    return this.variables.get(name);
  }

  /**
   * 清空已提取的变量
   */
  clear(): void {
    this.variables.clear();
  }
}

/**
 * 全局 CSS 变量解析器实例
 */
export const cssVariableParser = new CSSVariableParser();

/**
 * 从样式对象中提取所有 CSS 变量引用
 */
export function extractCSSVariableReferences(styles: IRStyles): Map<string, string[]> {
  const references = new Map<string, string[]>();

  for (const [property, value] of Object.entries(styles)) {
    if (typeof value === "string" && value.includes("var(")) {
      const varRegex = /var\s*\(\s*(--[a-zA-Z0-9_-]+)/g;
      let match;

      while ((match = varRegex.exec(value)) !== null) {
        const varName = match[1];
        if (!references.has(varName)) {
          references.set(varName, []);
        }
        references.get(varName)!.push(property);
      }
    }
  }

  return references;
}

/**
 * 从标签和类名推断 IR 元素类型。
 */
export function extractElementType(tagName: string, className?: string): IRElementType {
  const lowerTag = tagName.toLowerCase();
  const cls = (className || "").toLowerCase();

  if (lowerTag === "img" || lowerTag === "svg" || cls.includes("image")) {
    return ElementType.IMAGE;
  }

  if (lowerTag === "button" || cls.includes("btn") || cls.includes("button")) {
    return ElementType.BUTTON;
  }

  if (lowerTag === "input" || lowerTag === "textarea" || lowerTag === "select") {
    return ElementType.INPUT;
  }

  if (lowerTag === "a" || cls.includes("link")) {
    return ElementType.LINK;
  }

  if (
    lowerTag === "span" ||
    lowerTag === "p" ||
    lowerTag === "h1" ||
    lowerTag === "h2" ||
    lowerTag === "h3" ||
    lowerTag === "h4" ||
    lowerTag === "h5" ||
    lowerTag === "h6" ||
    lowerTag === "label" ||
    lowerTag === "strong" ||
    lowerTag === "em" ||
    lowerTag === "small" ||
    lowerTag === "b" ||
    lowerTag === "i" ||
    lowerTag === "code" ||
    lowerTag === "pre" ||
    lowerTag === "blockquote" ||
    lowerTag === "li"
  ) {
    return ElementType.TEXT;
  }

  return ElementType.CONTAINER;
}

/**
 * 解析 style 属性为 IRStyles。
 */
export function parseInlineStyle(style: string): IRStyles {
  const result: IRStyles = {};

  if (!style) {
    return result;
  }

  style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [rawKey, ...rawValue] = entry.split(":");
      if (!rawKey || rawValue.length === 0) {
        return;
      }

      const key = toCamelCase(rawKey.trim());
      const value = rawValue.join(":").trim();
      if (!value) {
        return;
      }

      const parsed = tryParseNumeric(value);
      result[key] = parsed;
    });

  return result;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function tryParseNumeric(value: string): string | number {
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (/^-?\d+(\.\d+)?px$/.test(value)) {
    return Number(value.replace(/px$/, ""));
  }

  return value;
}
