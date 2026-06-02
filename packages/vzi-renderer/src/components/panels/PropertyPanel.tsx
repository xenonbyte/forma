/**
 * 属性面板组件
 *
 * 任务 5.27: 实现选中元素详情的属性面板
 *
 * 显示内容：
 * - 基本信息（ID、类型、标签名、类名）
 * - 位置和尺寸（x, y, width, height）
 * - 样式（背景色、边框、字体等）
 * - 文本内容（如果有）
 * - 效果（阴影、滤镜等）
 */

import { memo } from 'react';
import type { IRElement, IRStyles, IRSource, IREffects, IRTransform } from '@vzi-core/types';

/**
 * 属性面板属性
 */
export interface PropertyPanelProps {
  /** 当前选中的元素，null 表示无选中 */
  element: IRElement | null;
  /** 自定义类名 */
  className?: string;
  /** 样式对象 */
  style?: React.CSSProperties;
  /** 是否显示完整信息（默认简化显示） */
  detailed?: boolean;
  /** 点击属性值回调（用于复制等操作） */
  onPropertyValueClick?: (key: string, value: string) => void;
}

/**
 * 面板样式常量
 */
const PANEL_STYLES = {
  headerBg: '#f5f5f5',
  headerColor: '#333333',
  borderColor: '#e0e0e0',
  labelColor: '#666666',
  valueColor: '#333333',
  sectionTitleColor: '#888888',
  fontSize: 12,
  lineHeight: 1.5,
  rowPadding: '6px 12px',
};

/**
 * 元素类型中文映射
 */
const ELEMENT_TYPE_NAMES: Record<string, string> = {
  container: '容器',
  text: '文本',
  image: '图片',
  button: '按钮',
  input: '输入框',
  link: '链接',
};

/**
 * 元素类型图标
 */
const ELEMENT_TYPE_ICONS: Record<string, string> = {
  container: '📦',
  text: '📝',
  image: '🖼️',
  button: '🔘',
  input: '✏️',
  link: '🔗',
};

/**
 * 格式化像素值
 */
function formatPixel(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'number') return `${Math.round(value * 100) / 100}px`;
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);
  return `${Math.round(num * 100) / 100}px`;
}

/**
 * 格式化颜色值（截断过长的颜色）
 */
function formatColor(color: string | undefined | null): string {
  if (!color) return '-';
  // 保留颜色格式但截断过长的值
  if (color.length > 30) {
    return `${color.slice(0, 27)}...`;
  }
  return color;
}

/**
 * 格式化透明度
 */
function formatOpacity(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return String(value);
  return `${Math.round(num * 100)}%`;
}

/**
 * 格式化字体大小
 */
function formatFontSize(value: string | number | undefined | null): string {
  return formatPixel(value);
}

/**
 * 格式化边框圆角
 */
function formatBorderRadius(value: string | number | undefined | null): string {
  return formatPixel(value);
}

/**
 * 属性行组件
 */
interface PropertyRowProps {
  label: string;
  value: string;
  valueColor?: string;
  onClick?: () => void;
  mono?: boolean;
}

const PropertyRow = memo<PropertyRowProps>(({
  label,
  value,
  valueColor,
  onClick,
  mono = false,
}) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      padding: PANEL_STYLES.rowPadding,
      borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
      cursor: onClick ? 'pointer' : 'default',
    }}
    onClick={onClick}
    title={onClick ? '点击复制' : undefined}
  >
    <span
      style={{
        color: PANEL_STYLES.labelColor,
        fontSize: PANEL_STYLES.fontSize,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: valueColor || PANEL_STYLES.valueColor,
        fontSize: PANEL_STYLES.fontSize,
        fontFamily: mono ? 'monospace' : undefined,
        wordBreak: 'break-all',
        textAlign: 'right',
        marginLeft: 12,
      }}
    >
      {value}
    </span>
  </div>
));

PropertyRow.displayName = 'PropertyRow';

/**
 * 分隔标题组件
 */
interface SectionTitleProps {
  title: string;
}

const SectionTitle = memo<SectionTitleProps>((({ title }) => (
  <div
    style={{
      padding: '8px 12px 4px',
      fontSize: 11,
      fontWeight: 600,
      color: PANEL_STYLES.sectionTitleColor,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderTop: `1px solid ${PANEL_STYLES.borderColor}`,
      marginTop: 4,
    }}
  >
    {title}
  </div>
)));

SectionTitle.displayName = 'SectionTitle';

/**
 * 颜色预览组件
 */
interface ColorPreviewProps {
  color: string;
  label: string;
  onClick?: () => void;
}

const ColorPreview = memo<ColorPreviewProps>((({ color, label, onClick }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: PANEL_STYLES.rowPadding,
      borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
      cursor: onClick ? 'pointer' : 'default',
    }}
    onClick={onClick}
    title={onClick ? '点击复制' : undefined}
  >
    <div
      style={{
        width: 16,
        height: 16,
        backgroundColor: color || 'transparent',
        border: `1px solid ${PANEL_STYLES.borderColor}`,
        borderRadius: 2,
        flexShrink: 0,
      }}
    />
    <span style={{ color: PANEL_STYLES.labelColor, fontSize: PANEL_STYLES.fontSize, flex: 1 }}>
      {label}
    </span>
    <span
      style={{
        color: PANEL_STYLES.valueColor,
        fontSize: PANEL_STYLES.fontSize,
        fontFamily: 'monospace',
      }}
    >
      {formatColor(color)}
    </span>
  </div>
)));

ColorPreview.displayName = 'ColorPreview';

/**
 * 空状态组件
 */
const EmptyState = memo(() => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: PANEL_STYLES.labelColor,
      fontSize: PANEL_STYLES.fontSize,
      padding: 24,
      textAlign: 'center',
    }}
  >
    <div style={{ fontSize: 32, marginBottom: 12 }}>👆</div>
    <div>点击画布中的元素</div>
    <div style={{ marginTop: 4 }}>查看详细属性</div>
  </div>
));

EmptyState.displayName = 'EmptyState';

/**
 * 渲染基本信息区域
 */
function renderBasicInfo(
  element: IRElement,
  onPropertyValueClick?: (key: string, value: string) => void
): JSX.Element {
  const { id, type, source } = element;

  return (
    <>
      {/* 类型 */}
      <PropertyRow
        label="类型"
        value={`${ELEMENT_TYPE_ICONS[type] || '📦'} ${ELEMENT_TYPE_NAMES[type] || type}`}
      />

      {/* ID */}
      <PropertyRow
        label="ID"
        value={id}
        mono
        onClick={() => onPropertyValueClick?.('id', id)}
      />

      {/* 标签名 */}
      {source?.tagName && (
        <PropertyRow
          label="标签"
          value={source.tagName.toLowerCase()}
          mono
          onClick={() => onPropertyValueClick?.('tagName', source.tagName!)}
        />
      )}

      {/* 类名 */}
      {source?.className && (
        <PropertyRow
          label="类名"
          value={source.className}
          mono
          onClick={() => onPropertyValueClick?.('className', source.className!)}
        />
      )}

      {/* DOM ID */}
      {source?.id && (
        <PropertyRow
          label="DOM ID"
          value={`#${source.id}`}
          mono
          onClick={() => onPropertyValueClick?.('domId', source.id!)}
        />
      )}

      {/* 语义角色 */}
      {source?.ariaAttributes?.role && (
        <PropertyRow
          label="角色"
          value={source.ariaAttributes.role}
        />
      )}

      {/* 组件名（如果有） */}
      {element.metadata?.componentName && (
        <PropertyRow
          label="组件"
          value={String(element.metadata.componentName)}
        />
      )}
    </>
  );
}

/**
 * 渲染位置和尺寸区域
 */
function renderPositionAndSize(
  element: IRElement,
  onPropertyValueClick?: (key: string, value: string) => void
): JSX.Element {
  const { bounds } = element;

  return (
    <>
      <SectionTitle title="位置与尺寸" />

      <PropertyRow
        label="X"
        value={formatPixel(bounds.x)}
        onClick={() => onPropertyValueClick?.('x', String(bounds.x))}
      />

      <PropertyRow
        label="Y"
        value={formatPixel(bounds.y)}
        onClick={() => onPropertyValueClick?.('y', String(bounds.y))}
      />

      <PropertyRow
        label="宽度"
        value={formatPixel(bounds.width)}
        onClick={() => onPropertyValueClick?.('width', String(bounds.width))}
      />

      <PropertyRow
        label="高度"
        value={formatPixel(bounds.height)}
        onClick={() => onPropertyValueClick?.('height', String(bounds.height))}
      />
    </>
  );
}

/**
 * 渲染样式区域
 */
function renderStyles(
  styles: IRStyles,
  onPropertyValueClick?: (key: string, value: string) => void
): JSX.Element | null {
  const hasStyles = Object.keys(styles).some(key => styles[key] !== undefined && styles[key] !== null);
  if (!hasStyles) return null;

  return (
    <>
      <SectionTitle title="样式" />

      {/* 背景色 */}
      {styles.backgroundColor && (
        <ColorPreview
          color={styles.backgroundColor as string}
          label="背景色"
          onClick={() => onPropertyValueClick?.('backgroundColor', styles.backgroundColor as string)}
        />
      )}

      {/* 背景渐变 */}
      {styles.background && !styles.backgroundColor && (
        <PropertyRow
          label="背景"
          value={formatColor(styles.background as string)}
          onClick={() => onPropertyValueClick?.('background', styles.background as string)}
        />
      )}

      {/* 透明度 */}
      {styles.opacity !== undefined && styles.opacity !== null && (
        <PropertyRow
          label="透明度"
          value={formatOpacity(styles.opacity)}
          onClick={() => onPropertyValueClick?.('opacity', String(styles.opacity))}
        />
      )}

      {/* 边框 */}
      {styles.border && (
        <PropertyRow
          label="边框"
          value={styles.border as string}
          onClick={() => onPropertyValueClick?.('border', styles.border as string)}
        />
      )}

      {/* 边框颜色 */}
      {styles.borderColor && (
        <ColorPreview
          color={styles.borderColor as string}
          label="边框颜色"
          onClick={() => onPropertyValueClick?.('borderColor', styles.borderColor as string)}
        />
      )}

      {/* 边框宽度 */}
      {styles.borderWidth && (
        <PropertyRow
          label="边框宽度"
          value={formatPixel(styles.borderWidth)}
        />
      )}

      {/* 边框圆角 */}
      {styles.borderRadius && (
        <PropertyRow
          label="圆角"
          value={formatBorderRadius(styles.borderRadius)}
          onClick={() => onPropertyValueClick?.('borderRadius', styles.borderRadius as string)}
        />
      )}

      {/* 阴影 */}
      {styles.boxShadow && (
        <PropertyRow
          label="阴影"
          value={styles.boxShadow as string}
          onClick={() => onPropertyValueClick?.('boxShadow', styles.boxShadow as string)}
        />
      )}

      {/* 字体 */}
      {(styles.fontSize || styles.fontWeight || styles.fontFamily) && (
        <>
          {styles.fontSize && (
            <PropertyRow
              label="字号"
              value={formatFontSize(styles.fontSize)}
              onClick={() => onPropertyValueClick?.('fontSize', String(styles.fontSize))}
            />
          )}

          {styles.fontWeight && (
            <PropertyRow
              label="字重"
              value={String(styles.fontWeight)}
              onClick={() => onPropertyValueClick?.('fontWeight', String(styles.fontWeight))}
            />
          )}

          {styles.fontFamily && (
            <PropertyRow
              label="字体"
              value={styles.fontFamily as string}
            />
          )}
        </>
      )}

      {/* 文本颜色 */}
      {styles.color && (
        <ColorPreview
          color={styles.color as string}
          label="文本颜色"
          onClick={() => onPropertyValueClick?.('color', styles.color as string)}
        />
      )}

      {/* 行高 */}
      {styles.lineHeight && (
        <PropertyRow
          label="行高"
          value={String(styles.lineHeight)}
        />
      )}

      {/* 文本对齐 */}
      {styles.textAlign && (
        <PropertyRow
          label="对齐"
          value={String(styles.textAlign)}
        />
      )}

      {/* 显示类型 */}
      {styles.display && (
        <PropertyRow
          label="Display"
          value={String(styles.display)}
        />
      )}

      {/* 定位 */}
      {styles.position && (
        <PropertyRow
          label="Position"
          value={String(styles.position)}
        />
      )}

      {/* 层级 */}
      {styles.zIndex && (
        <PropertyRow
          label="层级"
          value={String(styles.zIndex)}
        />
      )}
    </>
  );
}

/**
 * 渲染文本内容区域
 */
function renderTextContent(
  textContent: string | undefined,
  onPropertyValueClick?: (key: string, value: string) => void
): JSX.Element | null {
  if (!textContent) return null;

  // 截断过长的文本
  const displayText = textContent.length > 100
    ? `${textContent.slice(0, 100)}...`
    : textContent;

  return (
    <>
      <SectionTitle title="文本内容" />
      <div
        style={{
          padding: PANEL_STYLES.rowPadding,
          borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
          cursor: 'pointer',
        }}
        onClick={() => onPropertyValueClick?.('textContent', textContent)}
        title="点击复制完整内容"
      >
        <div
          style={{
            fontSize: PANEL_STYLES.fontSize,
            color: PANEL_STYLES.valueColor,
            lineHeight: PANEL_STYLES.lineHeight,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {displayText}
        </div>
        {textContent.length > 100 && (
          <div
            style={{
              fontSize: 10,
              color: PANEL_STYLES.labelColor,
              marginTop: 4,
            }}
          >
            共 {textContent.length} 个字符
          </div>
        )}
      </div>
    </>
  );
}

/**
 * 渲染效果区域
 */
function renderEffects(
  effects: IREffects | undefined,
  onPropertyValueClick?: (key: string, value: string) => void
): JSX.Element | null {
  if (!effects) return null;

  const { filters, shadows } = effects;
  if (!filters?.length && !shadows?.length) return null;

  return (
    <>
      <SectionTitle title="效果" />

      {/* 滤镜 */}
      {filters?.map((filter, index) => (
        <PropertyRow
          key={`filter-${index}`}
          label={`滤镜 ${index + 1}`}
          value={filter}
          onClick={() => onPropertyValueClick?.(`filter-${index}`, filter)}
        />
      ))}

      {/* 阴影 */}
      {shadows?.map((shadow, index) => (
        <PropertyRow
          key={`shadow-${index}`}
          label={`阴影 ${index + 1}`}
          value={`${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}`}
          onClick={() => onPropertyValueClick?.(`shadow-${index}`, JSON.stringify(shadow))}
        />
      ))}
    </>
  );
}

/**
 * 渲染变换区域
 */
function renderTransform(
  transform: IRTransform | undefined,
  onPropertyValueClick?: (key: string, value: string) => void
): JSX.Element | null {
  if (!transform) return null;

  const { translate, rotate, scale } = transform;
  if (!translate && !rotate && !scale) return null;

  return (
    <>
      <SectionTitle title="变换" />

      {translate && (
        <PropertyRow
          label="位移"
          value={`(${translate.x}, ${translate.y}${translate.z !== undefined ? `, ${translate.z}` : ''})`}
          onClick={() => onPropertyValueClick?.('translate', JSON.stringify(translate))}
        />
      )}

      {rotate && (
        <PropertyRow
          label="旋转"
          value={`(${rotate.x ?? 0}°, ${rotate.y ?? 0}°, ${rotate.z ?? 0}°)`}
          onClick={() => onPropertyValueClick?.('rotate', JSON.stringify(rotate))}
        />
      )}

      {scale && (
        <PropertyRow
          label="缩放"
          value={`(${scale.x}, ${scale.y}${scale.z !== undefined ? `, ${scale.z}` : ''})`}
          onClick={() => onPropertyValueClick?.('scale', JSON.stringify(scale))}
        />
      )}
    </>
  );
}

/**
 * 渲染链接属性
 */
function renderLinkProps(
  source: IRSource | undefined,
  onPropertyValueClick?: (key: string, value: string) => void
): JSX.Element | null {
  if (!source) return null;

  const { href, target, src, alt } = source;
  if (!href && !src) return null;

  return (
    <>
      <SectionTitle title="链接属性" />

      {href && (
        <PropertyRow
          label="链接"
          value={href}
          onClick={() => onPropertyValueClick?.('href', href)}
        />
      )}

      {target && (
        <PropertyRow
          label="目标"
          value={target}
        />
      )}

      {src && (
        <PropertyRow
          label="资源"
          value={src.length > 50 ? `${src.slice(0, 50)}...` : src}
          onClick={() => onPropertyValueClick?.('src', src)}
        />
      )}

      {alt && (
        <PropertyRow
          label="替代文本"
          value={alt}
          onClick={() => onPropertyValueClick?.('alt', alt)}
        />
      )}
    </>
  );
}

/**
 * 属性面板主组件
 */
export const PropertyPanel: React.FC<PropertyPanelProps> = memo(({
  element,
  className,
  style,
  detailed = false,
  onPropertyValueClick,
}) => {
  // 如果没有选中元素，显示空状态
  if (!element) {
    return (
      <div
        className={className}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#ffffff',
          border: `1px solid ${PANEL_STYLES.borderColor}`,
          borderRadius: 4,
          overflow: 'hidden',
          ...style,
        }}
      >
        <EmptyState />
      </div>
    );
  }

  const { styles, textContent, source, effects, transform } = element;

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        border: `1px solid ${PANEL_STYLES.borderColor}`,
        borderRadius: 4,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {/* 头部 */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${PANEL_STYLES.borderColor}`,
          backgroundColor: PANEL_STYLES.headerBg,
          fontWeight: 600,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>{ELEMENT_TYPE_ICONS[element.type] || '📦'}</span>
        <span>属性</span>
      </div>

      {/* 内容区域 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
        }}
      >
        {/* 基本信息 */}
        {renderBasicInfo(element, onPropertyValueClick)}

        {/* 位置和尺寸 */}
        {renderPositionAndSize(element, onPropertyValueClick)}

        {/* 样式 */}
        {renderStyles(styles, onPropertyValueClick)}

        {/* 文本内容 */}
        {renderTextContent(textContent, onPropertyValueClick)}

        {/* 链接属性 */}
        {renderLinkProps(source, onPropertyValueClick)}

        {/* 效果 */}
        {renderEffects(effects, onPropertyValueClick)}

        {/* 变换 */}
        {detailed && renderTransform(transform, onPropertyValueClick)}

        {/* 底部空白 */}
        <div style={{ height: 12 }} />
      </div>
    </div>
  );
});

PropertyPanel.displayName = 'PropertyPanel';
