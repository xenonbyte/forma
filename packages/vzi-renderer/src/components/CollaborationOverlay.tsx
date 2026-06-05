/**
 * 多用户光标组件
 *
 * 任务 5.33: 显示其他用户的光标位置
 */

import { memo, useMemo } from "react";
import type { OnlineUser } from "../hooks/useCollaboration";

/**
 * 多用户光标属性
 */
export interface UserCursorsProps {
  /** 在线用户列表（不含当前用户） */
  users: OnlineUser[];
  /** 当前缩放比例 */
  scale?: number;
  /** 画布偏移 X */
  offsetX?: number;
  /** 画布偏移 Y */
  offsetY?: number;
  /** 是否显示用户名 */
  showNames?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 单个光标组件
 */
interface SingleCursorProps {
  user: OnlineUser;
  scale: number;
  offsetX: number;
  offsetY: number;
  showName: boolean;
}

const SingleCursor = memo<SingleCursorProps>(({ user, scale, offsetX, offsetY, showName }) => {
  if (!user.cursor) return null;

  // 计算屏幕坐标
  const screenX = user.cursor.x * scale + offsetX;
  const screenY = user.cursor.y * scale + offsetY;

  // 光标 SVG 路径
  const cursorPath = "M0,0 L0,16 L4,12 L8,18 L10,17 L6,11 L12,11 Z";

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        pointerEvents: "none",
        zIndex: 1000,
        transform: "translate(-2px, -2px)",
      }}
    >
      {/* 光标图标 */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        style={{
          filter: "drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.3))",
        }}
      >
        <path d={cursorPath} fill={user.color} stroke="#ffffff" strokeWidth="1" />
      </svg>

      {/* 用户名标签 */}
      {showName && (
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 14,
            backgroundColor: user.color,
            color: "#ffffff",
            padding: "2px 6px",
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: "nowrap",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
          }}
        >
          {user.name}
        </div>
      )}
    </div>
  );
});

SingleCursor.displayName = "SingleCursor";

/**
 * 多用户光标组件
 */
export const UserCursors: React.FC<UserCursorsProps> = memo(
  ({ users, scale = 1, offsetX = 0, offsetY = 0, showNames = true, style }) => {
    // 过滤出有光标位置的用户
    const usersWithCursors = useMemo(() => {
      return users.filter((user) => user.cursor && !user.isCurrentUser);
    }, [users]);

    if (usersWithCursors.length === 0) return null;

    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: "none",
          overflow: "hidden",
          ...style,
        }}
      >
        {usersWithCursors.map((user) => (
          <SingleCursor
            key={user.id}
            user={user}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
            showName={showNames}
          />
        ))}
      </div>
    );
  },
);

UserCursors.displayName = "UserCursors";

/**
 * 用户选择框属性
 */
export interface UserSelectionsProps {
  /** 在线用户列表 */
  users: OnlineUser[];
  /** 当前缩放比例 */
  scale?: number;
  /** 画布偏移 X */
  offsetX?: number;
  /** 画布偏移 Y */
  offsetY?: number;
  /** 元素边界映射 */
  elementBounds: Map<string, { x: number; y: number; width: number; height: number }>;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 单个选择框组件
 */
interface SingleSelectionProps {
  user: OnlineUser;
  bounds: { x: number; y: number; width: number; height: number };
  scale: number;
  offsetX: number;
  offsetY: number;
}

const SingleSelection = memo<SingleSelectionProps>(({ user, bounds, scale, offsetX, offsetY }) => {
  const screenX = bounds.x * scale + offsetX;
  const screenY = bounds.y * scale + offsetY;
  const screenWidth = bounds.width * scale;
  const screenHeight = bounds.height * scale;

  return (
    <div
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        width: screenWidth,
        height: screenHeight,
        border: `2px solid ${user.color}`,
        borderRadius: 2,
        pointerEvents: "none",
        zIndex: 999,
      }}
    >
      {/* 用户名标签 */}
      <div
        style={{
          position: "absolute",
          top: -18,
          left: 0,
          backgroundColor: user.color,
          color: "#ffffff",
          padding: "1px 4px",
          borderRadius: 2,
          fontSize: 10,
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        {user.name}
      </div>
    </div>
  );
});

SingleSelection.displayName = "SingleSelection";

/**
 * 用户选择框组件
 *
 * 任务 5.34: 显示其他用户的选择状态
 */
export const UserSelections: React.FC<UserSelectionsProps> = memo(
  ({ users, scale = 1, offsetX = 0, offsetY = 0, elementBounds, style }) => {
    // 计算所有用户的选择框
    const selections = useMemo(() => {
      const result: Array<{
        user: OnlineUser;
        bounds: { x: number; y: number; width: number; height: number };
      }> = [];

      for (const user of users) {
        if (user.isCurrentUser || !user.selectedElementIds?.length) continue;

        for (const elementId of user.selectedElementIds) {
          const bounds = elementBounds.get(elementId);
          if (bounds) {
            result.push({ user, bounds });
          }
        }
      }

      return result;
    }, [users, elementBounds]);

    if (selections.length === 0) return null;

    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: "none",
          overflow: "hidden",
          ...style,
        }}
      >
        {selections.map((item, index) => (
          <SingleSelection
            key={`${item.user.id}-${index}`}
            user={item.user}
            bounds={item.bounds}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
          />
        ))}
      </div>
    );
  },
);

UserSelections.displayName = "UserSelections";

/**
 * 协作状态指示器
 */
export interface CollaborationIndicatorProps {
  /** 是否已连接 */
  isConnected: boolean;
  /** 用户数量 */
  userCount: number;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/**
 * 协作状态指示器组件
 */
export const CollaborationIndicator: React.FC<CollaborationIndicatorProps> = memo(
  ({ isConnected, userCount, style }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        backgroundColor: isConnected ? "#e8f5e9" : "#fff3e0",
        borderRadius: 4,
        fontSize: 12,
        color: isConnected ? "#2e7d32" : "#ef6c00",
        ...style,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: isConnected ? "#4caf50" : "#ff9800",
        }}
      />
      <span>{isConnected ? `${userCount} 人在线` : "离线"}</span>
    </div>
  ),
);

CollaborationIndicator.displayName = "CollaborationIndicator";
