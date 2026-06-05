/**
 * 高级 HTML 解析功能
 *
 * 包含：
 * - 2.13 自定义等待策略（selector, event, webComponents）
 * - 2.14 Shadow DOM 支持
 * - 2.15 动画/过渡提取
 * - 2.16 变换矩阵提取
 * - 2.17 滤镜效果提取
 */

import type { IRAnimations, IRTransform, IREffects, IRStyles, IRTransition, IRKeyframe } from "@vzi-core/types";

// ============================================
// 2.13 自定义等待策略
// ============================================

/**
 * 等待策略类型
 */
export type WaitStrategy =
  | { type: "none" }
  | { type: "selector"; selector: string; timeout?: number }
  | { type: "event"; eventName: string; timeout?: number }
  | { type: "webComponents"; timeout?: number }
  | { type: "networkIdle"; timeout?: number; idleTime?: number }
  | { type: "custom"; check: () => Promise<boolean>; timeout?: number };

/**
 * 等待策略配置
 */
export interface WaitStrategyOptions {
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number;
  /** 网络空闲检测的空闲时间 */
  networkIdleTime?: number;
}

/**
 * 等待策略管理器
 */
export class WaitStrategyManager {
  private options: Required<WaitStrategyOptions>;

  constructor(options: WaitStrategyOptions = {}) {
    this.options = {
      defaultTimeout: 30000,
      networkIdleTime: 500,
      ...options,
    };
  }

  /**
   * 解析等待策略配置
   */
  parseStrategy(config: unknown): WaitStrategy {
    if (!config || typeof config !== "object") {
      return { type: "none" };
    }

    const c = config as Record<string, unknown>;

    if (c.selector && typeof c.selector === "string") {
      return {
        type: "selector",
        selector: c.selector,
        timeout: typeof c.timeout === "number" ? c.timeout : this.options.defaultTimeout,
      };
    }

    if (c.event && typeof c.event === "string") {
      return {
        type: "event",
        eventName: c.event,
        timeout: typeof c.timeout === "number" ? c.timeout : this.options.defaultTimeout,
      };
    }

    if (c.webComponents === true) {
      return {
        type: "webComponents",
        timeout: typeof c.timeout === "number" ? c.timeout : this.options.defaultTimeout,
      };
    }

    if (c.networkIdle === true) {
      return {
        type: "networkIdle",
        timeout: typeof c.timeout === "number" ? c.timeout : this.options.defaultTimeout,
        idleTime: this.options.networkIdleTime,
      };
    }

    return { type: "none" };
  }

  /**
   * 从元素属性中提取等待策略
   */
  extractFromAttributes(attributes: Record<string, string>): WaitStrategy | null {
    if (attributes["data-wait-selector"]) {
      return this.parseStrategy({
        selector: attributes["data-wait-selector"],
        timeout: parseInt(attributes["data-wait-timeout"] || "", 10) || undefined,
      });
    }

    if (attributes["data-wait-event"]) {
      return this.parseStrategy({
        event: attributes["data-wait-event"],
        timeout: parseInt(attributes["data-wait-timeout"] || "", 10) || undefined,
      });
    }

    return null;
  }
}

// ============================================
// 2.14 Shadow DOM 支持
// ============================================

/**
 * Slot 信息
 */
export interface SlotInfo {
  name: string;
  assignedElementIds: string[];
}

/**
 * Shadow DOM 信息
 */
export interface ShadowDOMInfo {
  hostId: string;
  mode: "open" | "closed";
  slots: SlotInfo[];
  internalElementCount: number;
}

/**
 * Shadow DOM 检测器
 */
export class ShadowDOMDetector {
  /**
   * 检测元素是否为 Shadow DOM 宿主
   */
  isShadowHost(element: Element): boolean {
    return "shadowRoot" in element && (element as Element & { shadowRoot: unknown }).shadowRoot !== null;
  }

  /**
   * 检测自定义元素
   */
  isCustomElement(tagName: string): boolean {
    return tagName.includes("-");
  }

  /**
   * 获取 Shadow DOM 信息
   */
  getShadowInfo(element: Element): ShadowDOMInfo | null {
    if (!this.isShadowHost(element)) {
      return null;
    }

    const el = element as Element & { shadowRoot: { mode: string } };
    const mode: "open" | "closed" = el.shadowRoot?.mode === "closed" ? "closed" : "open";
    return {
      hostId: element.id || "",
      mode,
      slots: [],
      internalElementCount: 0,
    };
  }
}

// ============================================
// 2.15 动画/过渡提取
// ============================================

/**
 * 动画提取器
 */
export class AnimationExtractor {
  /**
   * 从计算样式中提取动画信息
   */
  extractAnimations(computedStyle: CSSStyleDeclaration): IRAnimations | undefined {
    const transitions = this.extractTransitions(computedStyle);
    const keyframes = this.extractKeyframeAnimations(computedStyle);

    if (transitions.length === 0 && keyframes.length === 0) {
      return undefined;
    }

    return {
      transitions: transitions.length > 0 ? transitions : undefined,
      keyframes: keyframes.length > 0 ? keyframes : undefined,
    };
  }

  /**
   * 提取过渡动画
   */
  private extractTransitions(computedStyle: CSSStyleDeclaration): IRTransition[] {
    const transitionProperty = computedStyle.transitionProperty;
    if (!transitionProperty || transitionProperty === "none" || transitionProperty === "all") {
      // 如果是 'all'，返回空数组，因为无法确定具体属性
      return [];
    }

    const properties = transitionProperty.split(",").map((p) => p.trim());
    const durations = (computedStyle.transitionDuration || "0s").split(",").map((d) => d.trim());
    const timingFunctions = (computedStyle.transitionTimingFunction || "ease").split(",").map((t) => t.trim());
    const delays = (computedStyle.transitionDelay || "0s").split(",").map((d) => d.trim());

    return properties.map((property, i) => ({
      property,
      duration: durations[i] || durations[0] || "0s",
      timingFunction: timingFunctions[i] || timingFunctions[0] || "ease",
      delay: delays[i] || delays[0] || "0s",
    }));
  }

  /**
   * 提取关键帧动画
   */
  private extractKeyframeAnimations(computedStyle: CSSStyleDeclaration): IRKeyframe[] {
    const animationName = computedStyle.animationName;
    if (!animationName || animationName === "none") {
      return [];
    }

    const names = animationName.split(",").map((n) => n.trim());

    return names.map((name) => ({
      name,
      steps: [], // 关键帧步需要在 CSS 解析时提取
    }));
  }

  /**
   * 提取平衡花括号内容：找到 startIndex 处的 '{' 并返回其配对的 '}' 之前的全部内容
   */
  private extractBalancedBraces(text: string, startIndex: number): string | null {
    if (text[startIndex] !== "{") return null;
    let depth = 0;
    let i = startIndex;
    while (i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return text.slice(startIndex + 1, i);
      }
      i++;
    }
    return null;
  }

  /**
   * 从 CSS 文本中提取 @keyframes 定义（支持嵌套花括号）
   */
  extractKeyframesFromCSS(cssText: string): Map<string, IRKeyframe> {
    const keyframeMap = new Map<string, IRKeyframe>();

    // 仅匹配 @keyframes name 部分，不依赖 [^}]+ 匹配 body
    const keyframeStartRegex = /@keyframes\s+([a-zA-Z0-9_-]+)\s*\{/g;
    let match;

    while ((match = keyframeStartRegex.exec(cssText)) !== null) {
      const name = match[1];
      // 定位到本次匹配的 '{' 位置，然后做平衡括号提取
      const braceStart = match.index + match[0].length - 1;
      const body = this.extractBalancedBraces(cssText, braceStart);
      if (body === null) continue;
      // 推进 lastIndex 以跳过整个 body，避免重复匹配
      keyframeStartRegex.lastIndex = braceStart + body.length + 2;

      const steps: Array<{ offset: string; styles: IRStyles }> = [];
      const stepRegex = /(\d+%|from|to)\s*\{([^}]+)\}/g;
      let stepMatch;

      while ((stepMatch = stepRegex.exec(body)) !== null) {
        const offset = stepMatch[1];
        const styleText = stepMatch[2];

        const styles: IRStyles = {};
        styleText.split(";").forEach((declaration) => {
          const [prop, value] = declaration.split(":").map((s) => s.trim());
          if (prop && value) {
            const camelProp = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            styles[camelProp] = value;
          }
        });

        steps.push({ offset, styles });
      }

      keyframeMap.set(name, { name, steps });
    }

    return keyframeMap;
  }
}

// ============================================
// 2.16 变换矩阵提取
// ============================================

/**
 * 变换矩阵提取器
 */
export class TransformExtractor {
  /**
   * 从计算样式中提取变换信息
   */
  extractTransform(computedStyle: CSSStyleDeclaration): IRTransform | undefined {
    const transform = computedStyle.transform;
    if (!transform || transform === "none") {
      return undefined;
    }

    const result: IRTransform = {};

    // 解析 matrix/matrix3d
    const matrixMatch = transform.match(/matrix(?:3d)?\(([^)]+)\)/);
    if (matrixMatch) {
      const values = matrixMatch[1].split(",").map((v) => parseFloat(v.trim()));
      if (values.length === 6) {
        result.matrix = [values[0], values[1], values[2], values[3], values[4], values[5]];
      } else if (values.length === 16) {
        result.matrix = values;
      }
    }

    // 解析 translate
    const translateMatch = transform.match(/translate(?:3d)?\(([^)]+)\)/);
    if (translateMatch) {
      const values = translateMatch[1].split(",").map((v) => this.parseLength(v.trim()));
      result.translate = {
        x: values[0] || 0,
        y: values[1] || 0,
        z: values[2],
      };
    }

    // 解析 rotate
    const rotateMatch = transform.match(/rotate(?:X|Y|Z|3d)?\(([^)]+)\)/);
    if (rotateMatch) {
      const value = parseFloat(rotateMatch[1]);
      const axis = rotateMatch[0].match(/rotate(X|Y|Z)?/)?.[1];
      result.rotate = {
        x: axis === "X" ? value : undefined,
        y: axis === "Y" ? value : undefined,
        z: !axis || axis === "Z" ? value : undefined,
      };
    }

    // 解析 scale
    const scaleMatch = transform.match(/scale(?:X|Y|Z|3d)?\(([^)]+)\)/);
    if (scaleMatch) {
      const values = scaleMatch[1].split(",").map((v) => parseFloat(v.trim()));
      result.scale = {
        x: values[0] || 1,
        y: values[1] ?? values[0] ?? 1,
        z: values[2],
      };
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * 解析长度值
   */
  private parseLength(value: string): number {
    const num = parseFloat(value);
    const unit = value.match(/(px|em|rem|%|vw|vh)?$/)?.[1];

    switch (unit) {
      case "em":
      case "rem":
        return num * 16;
      case "%":
        return num / 100;
      default:
        return num;
    }
  }
}

// ============================================
// 2.17 滤镜效果提取
// ============================================

/** 阴影数据结构 */
interface ShadowData {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: string;
  inset?: boolean;
}

/**
 * 滤镜效果提取器
 */
export class EffectsExtractor {
  /**
   * 从计算样式中提取效果信息
   */
  extractEffects(computedStyle: CSSStyleDeclaration): IREffects | undefined {
    const filters = this.extractFilters(computedStyle);
    const shadows = this.extractShadows(computedStyle);

    if (filters.length === 0 && shadows.length === 0) {
      return undefined;
    }

    return {
      filters: filters.length > 0 ? filters : undefined,
      shadows: shadows.length > 0 ? shadows : undefined,
    };
  }

  /**
   * 提取滤镜效果
   */
  private extractFilters(computedStyle: CSSStyleDeclaration): string[] {
    const filter = computedStyle.filter;
    if (!filter || filter === "none") {
      return [];
    }

    const filters: string[] = [];
    const filterRegex = /(\w+)\(([^)]+)\)/g;
    let match;

    while ((match = filterRegex.exec(filter)) !== null) {
      filters.push(`${match[1]}(${match[2]})`);
    }

    return filters;
  }

  /**
   * 提取阴影效果
   */
  private extractShadows(computedStyle: CSSStyleDeclaration): ShadowData[] {
    const shadows: ShadowData[] = [];

    const boxShadow = computedStyle.boxShadow;
    if (boxShadow && boxShadow !== "none") {
      shadows.push(...this.parseShadowString(boxShadow));
    }

    const textShadow = computedStyle.textShadow;
    if (textShadow && textShadow !== "none") {
      shadows.push(...this.parseShadowString(textShadow));
    }

    return shadows;
  }

  /**
   * 解析阴影字符串
   */
  private parseShadowString(shadowStr: string): ShadowData[] {
    const shadows: ShadowData[] = [];
    const shadowParts = shadowStr.split(/,(?![^(]*\))/);

    for (const part of shadowParts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "none") continue;

      const shadow = this.parseSingleShadow(trimmed);
      if (shadow) {
        shadows.push(shadow);
      }
    }

    return shadows;
  }

  /**
   * 解析单个阴影
   */
  private parseSingleShadow(str: string): ShadowData | null {
    const inset = str.includes("inset");
    const cleaned = str.replace("inset", "").trim();

    const numberRegex = /(-?[\d.]+)(px|em|rem)?/g;
    const numbers: number[] = [];
    let match;

    while ((match = numberRegex.exec(cleaned)) !== null) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      numbers.push(unit === "em" || unit === "rem" ? value * 16 : value);
    }

    if (numbers.length < 2) {
      return null;
    }

    const colorMatch = cleaned.match(/(#[a-fA-F0-9]+|rgb\([^)]+\)|rgba\([^)]+\)|[a-zA-Z]+)/);
    const color = colorMatch ? colorMatch[1] : "rgba(0, 0, 0, 0.5)";

    return {
      x: numbers[0] || 0,
      y: numbers[1] || 0,
      blur: numbers[2] || 0,
      spread: numbers[3],
      color,
      inset,
    };
  }
}

// ============================================
// 导出统一的提取器
// ============================================

/**
 * 高级样式提取器
 */
export class AdvancedStyleExtractor {
  readonly animation = new AnimationExtractor();
  readonly transform = new TransformExtractor();
  readonly effects = new EffectsExtractor();
  readonly shadowDOM = new ShadowDOMDetector();
  readonly waitStrategy = new WaitStrategyManager();

  /**
   * 从计算样式中提取所有高级属性
   */
  extractAll(computedStyle: CSSStyleDeclaration): {
    animations?: IRAnimations;
    transform?: IRTransform;
    effects?: IREffects;
  } {
    return {
      animations: this.animation.extractAnimations(computedStyle),
      transform: this.transform.extractTransform(computedStyle),
      effects: this.effects.extractEffects(computedStyle),
    };
  }
}

/**
 * 全局高级样式提取器实例
 */
export const advancedStyleExtractor = new AdvancedStyleExtractor();
