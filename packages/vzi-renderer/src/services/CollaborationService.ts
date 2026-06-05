/**
 * 协作服务 - WebSocket 连接管理
 *
 * 任务 5.32: 实现 WebSocket 连接和基础协作功能
 *
 * 功能：
 * - WebSocket 连接管理
 * - 用户加入/离开通知
 * - 光标位置同步
 * - 选择状态同步
 * - 心跳保活
 */

/**
 * 协作用户信息
 */
export interface CollaborationUser {
  /** 用户 ID */
  id: string;
  /** 用户名 */
  name: string;
  /** 用户颜色（用于光标和选择框） */
  color: string;
  /** 光标位置 */
  cursor?: {
    x: number;
    y: number;
  };
  /** 选中的元素 ID 列表 */
  selectedElementIds?: string[];
  /** 最后活跃时间 */
  lastActiveAt: number;
}

/**
 * 协作消息类型
 */
export type CollaborationMessageType =
  | "join" // 用户加入
  | "leave" // 用户离开
  | "cursor" // 光标移动
  | "select" // 元素选择
  | "deselect" // 取消选择
  | "edit" // 元素编辑
  | "ping" // 心跳
  | "pong" // 心跳响应
  | "sync" // 全量同步
  | "error"; // 错误

/**
 * 协作消息
 */
export interface CollaborationMessage {
  /** 消息类型 */
  type: CollaborationMessageType;
  /** 发送者 ID */
  senderId: string;
  /** 消息数据 */
  data: unknown;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 用户加入消息数据
 */
export interface JoinMessageData {
  user: CollaborationUser;
  designId: string;
}

/**
 * 光标消息数据
 */
export interface CursorMessageData {
  x: number;
  y: number;
  scale?: number;
}

/**
 * 选择消息数据
 */
export interface SelectMessageData {
  elementIds: string[];
}

/**
 * 协作服务配置
 */
export interface CollaborationServiceConfig {
  /** WebSocket 服务器 URL */
  serverUrl: string;
  /** 设计稿 ID */
  designId: string;
  /** 当前用户信息 */
  user: {
    id: string;
    name: string;
  };
  /** 重连间隔（毫秒） */
  reconnectInterval?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number;
  /** 用户颜色列表 */
  userColors?: string[];
}

/**
 * 协作服务事件
 */
export interface CollaborationServiceEvents {
  /** 连接成功 */
  onConnect: () => void;
  /** 连接断开 */
  onDisconnect: () => void;
  /** 用户加入 */
  onUserJoin: (user: CollaborationUser) => void;
  /** 用户离开 */
  onUserLeave: (userId: string) => void;
  /** 用户光标更新 */
  onUserCursorUpdate: (userId: string, cursor: { x: number; y: number }) => void;
  /** 用户选择更新 */
  onUserSelectUpdate: (userId: string, elementIds: string[]) => void;
  /** 错误 */
  onError: (error: Error) => void;
  /** 用户列表更新 */
  onUsersUpdate: (users: CollaborationUser[]) => void;
}

/**
 * 默认用户颜色
 */
const DEFAULT_USER_COLORS = [
  "#FF6B6B", // 红
  "#4ECDC4", // 青
  "#45B7D1", // 蓝
  "#96CEB4", // 绿
  "#FFEAA7", // 黄
  "#DDA0DD", // 紫
  "#98D8C8", // 薄荷
  "#F7DC6F", // 金
  "#BB8FCE", // 淡紫
  "#85C1E9", // 天蓝
];

/**
 * 协作服务类
 */
export class CollaborationService {
  private config: Required<CollaborationServiceConfig>;
  private events: Partial<CollaborationServiceEvents>;
  private ws: WebSocket | null = null;
  private users: Map<string, CollaborationUser> = new Map();
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  private colorIndex = 0;

  constructor(config: CollaborationServiceConfig, events: Partial<CollaborationServiceEvents> = {}) {
    this.config = {
      reconnectInterval: 3000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
      userColors: DEFAULT_USER_COLORS,
      ...config,
    };
    this.events = events;
  }

  /**
   * 连接到协作服务器
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = `${this.config.serverUrl}?designId=${this.config.designId}&userId=${this.config.user.id}&userName=${encodeURIComponent(this.config.user.name)}`;

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.events.onConnect?.();
          resolve();
        };

        this.ws.onclose = () => {
          this.handleDisconnect();
        };

        this.ws.onerror = (error) => {
          this.events.onError?.(new Error("WebSocket error"));
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.users.clear();
  }

  /**
   * 发送消息
   */
  private send(type: CollaborationMessageType, data: unknown): void {
    if (!this.ws || !this.isConnected) {
      console.warn("CollaborationService: Cannot send message, not connected");
      return;
    }

    const message: CollaborationMessage = {
      type,
      senderId: this.config.user.id,
      data,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(data: string): void {
    try {
      const message: CollaborationMessage = JSON.parse(data);

      // 忽略自己发送的消息
      if (message.senderId === this.config.user.id) {
        return;
      }

      switch (message.type) {
        case "join":
          this.handleUserJoin(message.data as JoinMessageData);
          break;

        case "leave":
          this.handleUserLeave(message.senderId);
          break;

        case "cursor":
          this.handleCursorUpdate(message.senderId, message.data as CursorMessageData);
          break;

        case "select":
          this.handleSelectUpdate(message.senderId, message.data as SelectMessageData);
          break;

        case "sync":
          this.handleSync(message.data as { users: CollaborationUser[] });
          break;

        case "pong":
          // 心跳响应，不需要处理
          break;
      }
    } catch (error) {
      console.error("CollaborationService: Failed to parse message", error);
    }
  }

  /**
   * 处理用户加入
   */
  private handleUserJoin(data: JoinMessageData): void {
    const user = data.user;
    user.lastActiveAt = Date.now();
    this.users.set(user.id, user);
    this.events.onUserJoin?.(user);
    this.notifyUsersUpdate();
  }

  /**
   * 处理用户离开
   */
  private handleUserLeave(userId: string): void {
    this.users.delete(userId);
    this.events.onUserLeave?.(userId);
    this.notifyUsersUpdate();
  }

  /**
   * 处理光标更新
   */
  private handleCursorUpdate(userId: string, data: CursorMessageData): void {
    const user = this.users.get(userId);
    if (user) {
      user.cursor = { x: data.x, y: data.y };
      user.lastActiveAt = Date.now();
      this.events.onUserCursorUpdate?.(userId, user.cursor);
    }
  }

  /**
   * 处理选择更新
   */
  private handleSelectUpdate(userId: string, data: SelectMessageData): void {
    const user = this.users.get(userId);
    if (user) {
      user.selectedElementIds = data.elementIds;
      user.lastActiveAt = Date.now();
      this.events.onUserSelectUpdate?.(userId, data.elementIds);
    }
  }

  /**
   * 处理全量同步
   */
  private handleSync(data: { users: CollaborationUser[] }): void {
    this.users.clear();
    for (const user of data.users) {
      if (user.id !== this.config.user.id) {
        user.lastActiveAt = Date.now();
        this.users.set(user.id, user);
      }
    }
    this.notifyUsersUpdate();
  }

  /**
   * 通知用户列表更新
   */
  private notifyUsersUpdate(): void {
    this.events.onUsersUpdate?.(Array.from(this.users.values()));
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(): void {
    this.isConnected = false;
    this.stopHeartbeat();
    this.events.onDisconnect?.();

    // 尝试重连
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect().catch(console.error);
      }, this.config.reconnectInterval);
    }
  }

  /**
   * 开始心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send("ping", {});
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ============================================
  // 公共 API
  // ============================================

  /**
   * 发送光标位置
   */
  sendCursor(x: number, y: number): void {
    this.send("cursor", { x, y });
  }

  /**
   * 发送选择状态
   */
  sendSelection(elementIds: string[]): void {
    this.send("select", { elementIds });
  }

  /**
   * 发送取消选择
   */
  sendDeselect(): void {
    this.send("deselect", {});
  }

  /**
   * 发送编辑操作
   */
  sendEdit(operation: { type: string; elementId: string; changes: unknown }): void {
    this.send("edit", operation);
  }

  /**
   * 获取所有在线用户
   */
  getUsers(): CollaborationUser[] {
    return Array.from(this.users.values());
  }

  /**
   * 获取指定用户
   */
  getUser(userId: string): CollaborationUser | undefined {
    return this.users.get(userId);
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * 分配用户颜色
   */
  assignColor(): string {
    const color = this.config.userColors[this.colorIndex % this.config.userColors.length];
    this.colorIndex++;
    return color;
  }
}
