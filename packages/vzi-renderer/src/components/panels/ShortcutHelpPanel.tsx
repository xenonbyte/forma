/**
 * 快捷键帮助面板组件
 *
 * 任务 5.31: 提供快捷键帮助信息显示
 */

import { memo, useState } from 'react';
import { SHORTCUT_HELP, type ShortcutItem } from '../../hooks/useKeyboardShortcuts';

/**
 * 快捷键帮助面板属性
 */
export interface ShortcutHelpPanelProps {
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 是否显示 */
  visible?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
}

/**
 * 快捷键帮助面板
 */
export const ShortcutHelpPanel: React.FC<ShortcutHelpPanelProps> = memo(({
  className,
  style,
  visible = true,
  onClose,
}) => {
  if (!visible) return null;

  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        ...style,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          maxWidth: 480,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: '#333333',
            }}
          >
            ⌨️ 键盘快捷键
          </h3>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 18,
              color: '#666666',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f0f0f0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div style={{ padding: '12px 0' }}>
          {SHORTCUT_HELP.map((shortcut: ShortcutItem, index: number) => (
            <div
              key={index}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 20px',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f8f8f8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: '#333333',
                }}
              >
                {shortcut.description}
              </span>
              <kbd
                style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  backgroundColor: '#f0f0f0',
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #d0d0d0',
                  color: '#333333',
                }}
              >
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>

        {/* 底部 */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e0e0e0',
            textAlign: 'center',
            fontSize: 12,
            color: '#888888',
          }}
        >
          按 ? 或 Escape 关闭
        </div>
      </div>
    </div>
  );
});

ShortcutHelpPanel.displayName = 'ShortcutHelpPanel';

/**
 * 快捷键帮助按钮
 */
export const ShortcutHelpButton: React.FC<{
  onClick?: () => void;
}> = memo(({ onClick }) => (
  <button
    onClick={onClick}
    style={{
      width: 32,
      height: 32,
      border: '1px solid #e0e0e0',
      background: '#ffffff',
      cursor: 'pointer',
      fontSize: 14,
      color: '#666666',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      transition: 'all 0.15s ease',
    }}
    title="键盘快捷键 (?)"
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = '#f5f5f5';
      e.currentTarget.style.borderColor = '#d0d0d0';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = '#ffffff';
      e.currentTarget.style.borderColor = '#e0e0e0';
    }}
  >
    ⌨️
  </button>
));

ShortcutHelpButton.displayName = 'ShortcutHelpButton';

/**
 * 快捷键帮助 Hook
 *
 * 用于管理帮助面板的显示状态
 */
export function useShortcutHelp(): {
  showHelp: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
} {
  const [showHelp, setShowHelp] = useState(false);

  return {
    showHelp,
    openHelp: () => setShowHelp(true),
    closeHelp: () => setShowHelp(false),
    toggleHelp: () => setShowHelp((prev) => !prev),
  };
}
