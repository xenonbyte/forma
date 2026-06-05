/**
 * 设计令牌面板组件
 *
 * 任务 5.28: 实现颜色、字体、间距令牌面板
 *
 * 显示内容：
 * - 颜色令牌（按类别分组）
 * - 字体令牌（字体族、字号、字重）
 * - 间距令牌（常用间距值）
 */

import { memo, useState, useMemo, useCallback } from "react";
import type { ColorToken, FontToken, ColorCategory } from "../../types/design-tokens";

/**
 * 间距令牌类型
 */
export interface SpacingToken {
  /** 间距值（像素） */
  value: number;
  /** 间距类型 */
  type: string;
  /** 出现频率 */
  frequency: number;
}

/**
 * 设计令牌面板属性
 */
export interface TokenPanelProps {
  /** 颜色令牌列表 */
  colorTokens?: ColorToken[];
  /** 字体令牌列表 */
  fontTokens?: FontToken[];
  /** 间距令牌列表 */
  spacingTokens?: SpacingToken[];
  /** 自定义类名 */
  className?: string;
  /** 样式对象 */
  style?: React.CSSProperties;
  /** 令牌点击回调（用于复制等操作） */
  onTokenClick?: (type: "color" | "font" | "spacing", token: unknown) => void;
}

/**
 * 面板样式常量
 */
const PANEL_STYLES = {
  headerBg: "#f5f5f5",
  headerColor: "#333333",
  borderColor: "#e0e0e0",
  labelColor: "#666666",
  valueColor: "#333333",
  sectionTitleColor: "#888888",
  fontSize: 12,
  lineHeight: 1.5,
};

/**
 * 颜色类别中文映射
 */
const COLOR_CATEGORY_NAMES: Record<ColorCategory, string> = {
  primary: "主色",
  secondary: "辅色",
  accent: "强调色",
  background: "背景色",
  text: "文本色",
  border: "边框色",
  other: "其他",
};

/**
 * 颜色类别排序
 */
const COLOR_CATEGORY_ORDER: ColorCategory[] = [
  "primary",
  "secondary",
  "accent",
  "background",
  "text",
  "border",
  "other",
];

/**
 * 标签页类型
 */
type TabType = "colors" | "fonts" | "spacing";

/**
 * 令牌类型（用于回调）
 */
type TokenType = "color" | "font" | "spacing";

/**
 * 标签页配置
 */
const TABS: { key: TabType; label: string; icon: string; tokenType: TokenType }[] = [
  { key: "colors", label: "颜色", icon: "🎨", tokenType: "color" },
  { key: "fonts", label: "字体", icon: "🔤", tokenType: "font" },
  { key: "spacing", label: "间距", icon: "↔️", tokenType: "spacing" },
];

/**
 * 分隔标题组件
 */
interface SectionTitleProps {
  title: string;
  count?: number;
}

const SectionTitle = memo<SectionTitleProps>(({ title, count }) => (
  <div
    style={{
      padding: "8px 12px 4px",
      fontSize: 11,
      fontWeight: 600,
      color: PANEL_STYLES.sectionTitleColor,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}
  >
    <span>{title}</span>
    {count !== undefined && <span style={{ fontWeight: 400 }}>{count}</span>}
  </div>
));

SectionTitle.displayName = "SectionTitle";

/**
 * 颜色令牌项组件
 */
interface ColorTokenItemProps {
  token: ColorToken;
  onClick?: () => void;
}

const ColorTokenItem = memo<ColorTokenItemProps>(({ token, onClick }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 12px",
      borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
      cursor: onClick ? "pointer" : "default",
    }}
    onClick={onClick}
    title={onClick ? "点击复制颜色值" : undefined}
  >
    {/* 颜色预览 */}
    <div
      style={{
        width: 28,
        height: 28,
        backgroundColor: token.value || "transparent",
        border: `1px solid ${PANEL_STYLES.borderColor}`,
        borderRadius: 4,
        flexShrink: 0,
      }}
    />

    {/* 颜色信息 */}
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* 名称 */}
      {token.name && (
        <div
          style={{
            fontSize: PANEL_STYLES.fontSize,
            color: PANEL_STYLES.valueColor,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {token.name}
        </div>
      )}

      {/* 颜色值 */}
      <div
        style={{
          fontSize: 11,
          fontFamily: "monospace",
          color: PANEL_STYLES.labelColor,
        }}
      >
        {token.value}
      </div>
    </div>

    {/* 频率 */}
    <div
      style={{
        fontSize: 10,
        color: PANEL_STYLES.labelColor,
        flexShrink: 0,
      }}
    >
      ×{token.frequency}
    </div>
  </div>
));

ColorTokenItem.displayName = "ColorTokenItem";

/**
 * 字体令牌项组件
 */
interface FontTokenItemProps {
  token: FontToken;
  index: number;
  onClick?: () => void;
}

const FontTokenItem = memo<FontTokenItemProps>(({ token, index, onClick }) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: "8px 12px",
      borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
      cursor: onClick ? "pointer" : "default",
    }}
    onClick={onClick}
    title={onClick ? "点击复制字体信息" : undefined}
  >
    {/* 序号 */}
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        backgroundColor: "#f0f0f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        color: PANEL_STYLES.labelColor,
        flexShrink: 0,
      }}
    >
      {index + 1}
    </div>

    {/* 字体信息 */}
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* 字体族 */}
      <div
        style={{
          fontSize: PANEL_STYLES.fontSize,
          color: PANEL_STYLES.valueColor,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {token.fontFamily}
      </div>

      {/* 字体属性 */}
      <div
        style={{
          fontSize: 11,
          color: PANEL_STYLES.labelColor,
          marginTop: 2,
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 8px",
        }}
      >
        {token.fontSize && <span>{token.fontSize}px</span>}
        {token.fontWeight && <span>· {token.fontWeight}</span>}
        {token.lineHeight && <span>· {token.lineHeight}</span>}
      </div>

      {/* 使用场景 */}
      {token.usage && (
        <div
          style={{
            fontSize: 10,
            color: PANEL_STYLES.labelColor,
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          {token.usage}
        </div>
      )}
    </div>

    {/* 频率 */}
    <div
      style={{
        fontSize: 10,
        color: PANEL_STYLES.labelColor,
        flexShrink: 0,
      }}
    >
      ×{token.frequency}
    </div>
  </div>
));

FontTokenItem.displayName = "FontTokenItem";

/**
 * 间距令牌项组件
 */
interface SpacingTokenItemProps {
  token: SpacingToken;
  onClick?: () => void;
}

const SpacingTokenItem = memo<SpacingTokenItemProps>(({ token, onClick }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 12px",
      borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
      cursor: onClick ? "pointer" : "default",
    }}
    onClick={onClick}
    title={onClick ? "点击复制间距值" : undefined}
  >
    {/* 间距预览 */}
    <div
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: Math.min(token.value, 28),
          height: Math.min(token.value, 28),
          backgroundColor: "#0066ff",
          opacity: 0.3,
          borderRadius: 2,
        }}
      />
    </div>

    {/* 间距值 */}
    <div style={{ flex: 1 }}>
      <div
        style={{
          fontSize: PANEL_STYLES.fontSize,
          fontFamily: "monospace",
          color: PANEL_STYLES.valueColor,
        }}
      >
        {token.value}px
      </div>
      {token.type && (
        <div
          style={{
            fontSize: 10,
            color: PANEL_STYLES.labelColor,
          }}
        >
          {token.type}
        </div>
      )}
    </div>

    {/* 频率 */}
    <div
      style={{
        fontSize: 10,
        color: PANEL_STYLES.labelColor,
        flexShrink: 0,
      }}
    >
      ×{token.frequency}
    </div>
  </div>
));

SpacingTokenItem.displayName = "SpacingTokenItem";

/**
 * 空状态组件
 */
interface EmptyStateProps {
  type: TabType;
}

const EmptyState = memo<EmptyStateProps>(({ type }) => {
  const messages: Record<TabType, string> = {
    colors: "暂无颜色令牌",
    fonts: "暂无字体令牌",
    spacing: "暂无间距令牌",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: 150,
        color: PANEL_STYLES.labelColor,
        fontSize: PANEL_STYLES.fontSize,
      }}
    >
      <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
      <div>{messages[type]}</div>
    </div>
  );
});

EmptyState.displayName = "EmptyState";

/**
 * 颜色列表组件
 */
interface ColorListProps {
  tokens: ColorToken[];
  onTokenClick?: (token: ColorToken) => void;
}

const ColorList = memo<ColorListProps>(({ tokens, onTokenClick }) => {
  // 按类别分组
  const groupedTokens = useMemo(() => {
    const groups = new Map<ColorCategory, ColorToken[]>();

    for (const token of tokens) {
      const category = token.category || "other";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(token);
    }

    // 每组内按频率排序
    for (const group of groups.values()) {
      group.sort((a, b) => b.frequency - a.frequency);
    }

    return groups;
  }, [tokens]);

  // 按顺序渲染
  const orderedCategories = COLOR_CATEGORY_ORDER.filter((cat) => groupedTokens.has(cat));

  if (orderedCategories.length === 0) {
    return <EmptyState type="colors" />;
  }

  return (
    <>
      {orderedCategories.map((category) => {
        const categoryTokens = groupedTokens.get(category)!;
        return (
          <div key={category}>
            <SectionTitle title={COLOR_CATEGORY_NAMES[category]} count={categoryTokens.length} />
            {categoryTokens.map((token, index) => (
              <ColorTokenItem key={`${token.value}-${index}`} token={token} onClick={() => onTokenClick?.(token)} />
            ))}
          </div>
        );
      })}
    </>
  );
});

ColorList.displayName = "ColorList";

/**
 * 字体列表组件
 */
interface FontListProps {
  tokens: FontToken[];
  onTokenClick?: (token: FontToken) => void;
}

const FontList = memo<FontListProps>(({ tokens, onTokenClick }) => {
  // 按频率排序
  const sortedTokens = useMemo(() => {
    return [...tokens].sort((a, b) => b.frequency - a.frequency);
  }, [tokens]);

  if (sortedTokens.length === 0) {
    return <EmptyState type="fonts" />;
  }

  return (
    <>
      <SectionTitle title="字体" count={sortedTokens.length} />
      {sortedTokens.map((token, index) => (
        <FontTokenItem
          key={`${token.fontFamily}-${token.fontSize}-${token.fontWeight}-${index}`}
          token={token}
          index={index}
          onClick={() => onTokenClick?.(token)}
        />
      ))}
    </>
  );
});

FontList.displayName = "FontList";

/**
 * 间距列表组件
 */
interface SpacingListProps {
  tokens: SpacingToken[];
  onTokenClick?: (token: SpacingToken) => void;
}

const SpacingList = memo<SpacingListProps>(({ tokens, onTokenClick }) => {
  // 按频率排序
  const sortedTokens = useMemo(() => {
    return [...tokens].sort((a, b) => b.frequency - a.frequency);
  }, [tokens]);

  if (sortedTokens.length === 0) {
    return <EmptyState type="spacing" />;
  }

  return (
    <>
      <SectionTitle title="间距" count={sortedTokens.length} />
      {sortedTokens.map((token, index) => (
        <SpacingTokenItem
          key={`${token.value}-${token.type}-${index}`}
          token={token}
          onClick={() => onTokenClick?.(token)}
        />
      ))}
    </>
  );
});

SpacingList.displayName = "SpacingList";

/**
 * 设计令牌面板主组件
 */
export const TokenPanel: React.FC<TokenPanelProps> = memo(
  ({ colorTokens = [], fontTokens = [], spacingTokens = [], className, style, onTokenClick }) => {
    // 当前标签页
    const [activeTab, setActiveTab] = useState<TabType>("colors");

    // 计算各类型数量
    const counts = useMemo(
      () => ({
        colors: colorTokens.length,
        fonts: fontTokens.length,
        spacing: spacingTokens.length,
      }),
      [colorTokens, fontTokens, spacingTokens],
    );

    // 令牌点击处理
    const handleTokenClick = useCallback(
      (type: TokenType, token: unknown) => {
        onTokenClick?.(type, token);
      },
      [onTokenClick],
    );

    return (
      <div
        className={className}
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#ffffff",
          border: `1px solid ${PANEL_STYLES.borderColor}`,
          borderRadius: 4,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...style,
        }}
      >
        {/* 头部标签页 */}
        <div
          style={{
            display: "flex",
            borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
            backgroundColor: PANEL_STYLES.headerBg,
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              style={{
                flex: 1,
                padding: "10px 8px",
                border: "none",
                background: activeTab === tab.key ? "#ffffff" : "transparent",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? PANEL_STYLES.valueColor : PANEL_STYLES.labelColor,
                borderBottom: activeTab === tab.key ? "2px solid #0066ff" : "2px solid transparent",
                transition: "all 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
              onClick={() => setActiveTab(tab.key)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              <span
                style={{
                  fontSize: 10,
                  opacity: 0.7,
                }}
              >
                ({counts[tab.key]})
              </span>
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
          }}
        >
          {activeTab === "colors" && (
            <ColorList tokens={colorTokens} onTokenClick={(token) => handleTokenClick("color", token)} />
          )}

          {activeTab === "fonts" && (
            <FontList tokens={fontTokens} onTokenClick={(token) => handleTokenClick("font", token)} />
          )}

          {activeTab === "spacing" && (
            <SpacingList tokens={spacingTokens} onTokenClick={(token) => handleTokenClick("spacing", token)} />
          )}
        </div>
      </div>
    );
  },
);

TokenPanel.displayName = "TokenPanel";
