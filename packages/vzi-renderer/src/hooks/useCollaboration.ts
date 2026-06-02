/**
 * 协作功能 Hook
 *
 * 任务 5.32: 提供 React Hook 接口的协作功能
 *
 * 使用示例：
 * ```tsx
 * const { users, sendCursor, sendSelection, isConnected } = useCollaboration({
 *   serverUrl: 'wss://api.example.com/collab',
 *   designId: 'design-123',
 *   user: { id: 'user-1', name: 'John' },
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CollaborationService,
  CollaborationUser,
  CollaborationServiceConfig,
  CollaborationServiceEvents,
} from '../services/CollaborationService';

/**
 * 协作 Hook 配置
 */
export interface UseCollaborationConfig {
  /** WebSocket 服务器 URL */
  serverUrl: string;
  /** 设计稿 ID */
  designId: string;
  /** 当前用户信息 */
  user: {
    id: string;
    name: string;
  };
  /** 是否自动连接 */
  autoConnect?: boolean;
  /** 重连间隔 */
  reconnectInterval?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
  /** 心跳间隔 */
  heartbeatInterval?: number;
  /** 是否启用（可用于条件性启用） */
  enabled?: boolean;
}

/**
 * 在线用户信息（扩展版）
 */
export interface OnlineUser extends CollaborationUser {
  /** 是否是当前用户 */
  isCurrentUser: boolean;
}

/**
 * 协作 Hook 返回值
 */
export interface UseCollaborationReturn {
  /** 是否已连接 */
  isConnected: boolean;
  /** 是否正在连接 */
  isConnecting: boolean;
  /** 连接错误 */
  error: Error | null;
  /** 在线用户列表 */
  users: OnlineUser[];
  /** 用户数量（包括自己） */
  userCount: number;
  /** 发送光标位置 */
  sendCursor: (x: number, y: number) => void;
  /** 发送选择状态 */
  sendSelection: (elementIds: string[]) => void;
  /** 发送取消选择 */
  sendDeselect: () => void;
  /** 手动连接 */
  connect: () => Promise<void>;
  /** 手动断开 */
  disconnect: () => void;
  /** 获取指定用户 */
  getUser: (userId: string) => OnlineUser | undefined;
}

/**
 * 协作功能 Hook
 */
export function useCollaboration(config: UseCollaborationConfig): UseCollaborationReturn {
  const {
    serverUrl,
    designId,
    user,
    autoConnect = true,
    enabled = true,
    reconnectInterval,
    maxReconnectAttempts,
    heartbeatInterval,
  } = config;

  // 状态
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [users, setUsers] = useState<OnlineUser[]>([]);

  // 服务引用
  const serviceRef = useRef<CollaborationService | null>(null);

  // 光标节流
  const lastCursorRef = useRef({ x: 0, y: 0 });
  const cursorThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 创建服务
  const createService = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
    }

    const serviceConfig: CollaborationServiceConfig = {
      serverUrl,
      designId,
      user,
      reconnectInterval,
      maxReconnectAttempts,
      heartbeatInterval,
    };

    const events: Partial<CollaborationServiceEvents> = {
      onConnect: () => {
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
      },

      onDisconnect: () => {
        setIsConnected(false);
        setIsConnecting(false);
      },

      onUserJoin: (newUser) => {
        setUsers((prev) => {
          if (prev.some((u) => u.id === newUser.id)) {
            return prev;
          }
          return [
            ...prev,
            { ...newUser, isCurrentUser: newUser.id === user.id },
          ];
        });
      },

      onUserLeave: (userId) => {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
      },

      onUserCursorUpdate: (userId, cursor) => {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, cursor } : u
          )
        );
      },

      onUserSelectUpdate: (userId, elementIds) => {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, selectedElementIds: elementIds } : u
          )
        );
      },

      onError: (err) => {
        setError(err);
        setIsConnecting(false);
      },

      onUsersUpdate: (updatedUsers) => {
        setUsers(
          updatedUsers.map((u) => ({
            ...u,
            isCurrentUser: u.id === user.id,
          }))
        );
      },
    };

    serviceRef.current = new CollaborationService(serviceConfig, events);
    return serviceRef.current;
  }, [serverUrl, designId, user, reconnectInterval, maxReconnectAttempts, heartbeatInterval]);

  // 连接
  const connect = useCallback(async () => {
    if (!enabled) return;

    setIsConnecting(true);
    setError(null);

    try {
      const service = createService();
      await service.connect();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsConnecting(false);
    }
  }, [enabled, createService]);

  // 断开
  const disconnect = useCallback(() => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
      serviceRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setUsers([]);
  }, []);

  // 发送光标（带节流）
  const sendCursor = useCallback((x: number, y: number) => {
    if (!serviceRef.current || !isConnected) return;

    // 节流：50ms 内只发送一次
    if (cursorThrottleTimerRef.current) {
      lastCursorRef.current = { x, y };
      return;
    }

    serviceRef.current.sendCursor(x, y);
    lastCursorRef.current = { x, y };

    cursorThrottleTimerRef.current = setTimeout(() => {
      cursorThrottleTimerRef.current = null;
      // 如果位置有变化，发送最新位置
      if (
        lastCursorRef.current.x !== x ||
        lastCursorRef.current.y !== y
      ) {
        serviceRef.current?.sendCursor(lastCursorRef.current.x, lastCursorRef.current.y);
      }
    }, 50);
  }, [isConnected]);

  // 发送选择
  const sendSelection = useCallback((elementIds: string[]) => {
    if (!serviceRef.current || !isConnected) return;
    serviceRef.current.sendSelection(elementIds);
  }, [isConnected]);

  // 发送取消选择
  const sendDeselect = useCallback(() => {
    if (!serviceRef.current || !isConnected) return;
    serviceRef.current.sendDeselect();
  }, [isConnected]);

  // 获取用户
  const getUser = useCallback((userId: string): OnlineUser | undefined => {
    return users.find((u) => u.id === userId);
  }, [users]);

  // 用户数量
  const userCount = useMemo(() => users.length + 1, [users.length]);

  // 自动连接
  useEffect(() => {
    if (enabled && autoConnect) {
      void connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, autoConnect, connect, disconnect]);

  // 清理节流定时器
  useEffect(() => {
    return () => {
      if (cursorThrottleTimerRef.current) {
        clearTimeout(cursorThrottleTimerRef.current);
      }
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    error,
    users,
    userCount,
    sendCursor,
    sendSelection,
    sendDeselect,
    connect,
    disconnect,
    getUser,
  };
}
