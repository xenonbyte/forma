/**
 * VZI 2.0 格式包
 *
 * 提供高效的二进制格式编码/解码，支持：
 * - MessagePack 序列化
 * - Brotli 压缩
 * - 分块存储和增量加载
 * - 四叉树空间索引
 */

// 导出类型
export * from './types';

// 导出编码器
export { VZIEncoder } from './encoder';

// 导出解码器
export { VZIDecoder } from './decoder';

// 导出空间索引
export { SpatialIndexBuilder } from './spatial-index';

// 导出工具函数
export {
  validateVZIFile,
  getVZIFileInfo,
  extractTokens,
} from './utils';
