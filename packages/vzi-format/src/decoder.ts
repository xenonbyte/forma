/**
 * VZI 2.0 解码器
 *
 * 任务 3.20-3.24: 实现快速读取、按块读取、块级缓存、增量加载
 */

import { createDecipheriv, createHash } from 'crypto';
import { brotliDecompressSync } from 'zlib';
import { decode } from 'msgpackr';
import type { IRElement } from '@vzi-core/types';
import type {
  VZIHeader,
  VZIContent,
  VZIMetadata,
  BlockIndexEntry,
  BlockType,
  QuadTreeIndex,
  ColorToken,
  FontToken,
  Annotation,
  ImageAsset,
  Layer,
  VersionCompatibility,
  SharedStyle,
  SpatialBlock,
  DecodeResult,
  BlockError,
  BlockErrorType,
} from './types';

/**
 * 解码器配置
 */
export interface VZIDecoderOptions {
  /** 解密密钥 */
  decryptionKey?: Uint8Array;
  /** LRU 缓存大小（块数） */
  cacheSize?: number;
  /** 是否验证校验和（块级 + 文件级） */
  verifyChecksums?: boolean;
  /** 最大内存使用（MB） */
  maxMemoryMB?: number;
  /** 是否启用错误恢复（默认 true） */
  enableErrorRecovery?: boolean;
  /** 是否在遇到致命错误时抛出异常（默认 false） */
  throwOnFatalError?: boolean;
  /** 单块 Brotli 解压后最大字节数，防解压炸弹（默认 256MB） */
  maxDecompressedBlockBytes?: number;
}

/**
 * 块缓存项
 */
interface CachedBlock {
  data: Uint8Array;
  size: number;
  timestamp: number;
  accessCount: number;
}

interface ResolvedVZIDecoderOptions {
  decryptionKey?: Uint8Array;
  cacheSize: number;
  verifyChecksums: boolean;
  maxMemoryMB: number;
  enableErrorRecovery: boolean;
  throwOnFatalError: boolean;
  maxDecompressedBlockBytes: number;
}

/**
 * VZI 2.0 解码器
 */
export class VZIDecoder {
  private options: ResolvedVZIDecoderOptions;
  private buffer!: Buffer;
  private header: VZIHeader | null = null;
  private blockIndex: BlockIndexEntry[] = [];
  private cache: Map<string, CachedBlock> = new Map();
  private cacheOrder: string[] = [];
  private cacheBytes = 0;
  private errors: BlockError[] = [];
  private successfulBlocks = 0;
  private failedBlocks = 0;
  private colorTokens: ColorToken[] = [];
  private fontTokens: FontToken[] = [];
  private layers: Layer[] = [];
  private compatibility: VersionCompatibility = this.getDefaultCompatibility();

  constructor(options: VZIDecoderOptions = {}) {
    const resolved: ResolvedVZIDecoderOptions = {
      decryptionKey: options.decryptionKey,
      cacheSize: 1000,
      verifyChecksums: true,
      maxMemoryMB: 100,
      enableErrorRecovery: false,  // 默认禁用错误恢复，保持向后兼容
      throwOnFatalError: false,
      maxDecompressedBlockBytes: 256 * 1024 * 1024, // 256MB 防解压炸弹
      ...options,
    };

    if (!Number.isFinite(resolved.cacheSize) || resolved.cacheSize < 0) {
      throw new Error('VZIDecoder cacheSize must be a non-negative number');
    }
    if (!Number.isFinite(resolved.maxMemoryMB) || resolved.maxMemoryMB < 0) {
      throw new Error('VZIDecoder maxMemoryMB must be a non-negative number');
    }
    if (resolved.decryptionKey && resolved.decryptionKey.length !== 32) {
      throw new Error('VZIDecoder decryptionKey must be 32 bytes');
    }

    this.options = resolved;
  }

  /**
   * 解码 VZI 文件（带错误恢复）
   */
  decode(buffer: Uint8Array): DecodeResult {
    this.buffer = Buffer.from(buffer);
    this.cache.clear();
    this.cacheOrder = [];
    this.cacheBytes = 0;
    this.errors = [];
    this.successfulBlocks = 0;
    this.failedBlocks = 0;
    this.colorTokens = [];
    this.fontTokens = [];
    this.layers = [];
    this.compatibility = this.getDefaultCompatibility();

    // 1. 读取并验证文件头（致命错误）
    try {
      this.header = this.readHeader(this.buffer);
    } catch (error) {
      throw new Error(`Failed to read VZI header: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 1b. 验证文件级 checksum（非全零才校验，全零表示旧版文件）
    if (this.options.verifyChecksums) {
      this.verifyFileChecksum(this.buffer, this.header);
    }

    // 1c. 验证 header 中的偏移量不越界
    this.validateHeaderOffsets(this.header, this.buffer.length);

    // 2. 读取块索引（致命错误，但在错误恢复模式下可以降级）
    try {
      this.blockIndex = this.readBlockIndex();
    } catch (error) {
      if (this.options.enableErrorRecovery) {
        // 在错误恢复模式下，记录错误并返回空内容
        this.recordError('block-index', 'metadata', 'corrupted_data',
          `Failed to read block index: ${error instanceof Error ? error.message : String(error)}`, true);
        return {
          content: this.getEmptyContent(),
          errors: this.errors,
          degraded: true,
          successfulBlocks: 0,
          failedBlocks: 1,
        };
      }
      throw new Error(`Failed to read block index: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. 读取元数据（致命错误）
    let metadata: VZIMetadata;
    try {
      metadata = this.readMetadata();
    } catch (error) {
      if (this.options.throwOnFatalError) {
        throw error;
      }
      // 使用默认元数据
      metadata = this.getDefaultMetadata();
      this.recordError('metadata', 'metadata', 'decode_failed',
        `Failed to read metadata: ${error instanceof Error ? error.message : String(error)}`, true);
    }

    // 4-12. 读取其他块（非致命错误，支持降级）
    const elements = this.readElementsWithRecovery();
    const sharedStyles = this.readSharedStylesWithRecovery();
    const spatialIndex = this.readSpatialIndexWithRecovery();
    const colorTokens = this.readColorTokensWithRecovery();
    const fontTokens = this.readFontTokensWithRecovery();
    const annotations = this.readAnnotationsWithRecovery();
    const images = this.readImagesWithRecovery();
    const layers = this.readLayersWithRecovery();
    const compatibility = this.readCompatibilityWithRecovery();

    const content: VZIContent = {
      header: this.header,
      metadata,
      elements,
      sharedStyles,
      spatialIndex,
      colorTokens,
      fontTokens,
      annotations,
      images,
      layers,
      compatibility,
    };

    return {
      content,
      errors: this.errors,
      degraded: this.errors.length > 0,
      successfulBlocks: this.successfulBlocks,
      failedBlocks: this.failedBlocks,
    };
  }

  /**
   * 解码 VZI 文件（旧接口，向后兼容）
   */
  decodeContent(buffer: Uint8Array): VZIContent {
    const result = this.decode(buffer);
    if (result.errors.length > 0 && this.options.throwOnFatalError) {
      const fatalErrors = result.errors.filter(e => e.fatal);
      if (fatalErrors.length > 0) {
        throw new Error(`Fatal errors during decoding: ${fatalErrors.map(e => e.message).join('; ')}`);
      }
    }
    return result.content;
  }

  /**
   * 快速读取文件头（无需解密）
   */
  quickReadHeader(buffer: Buffer): VZIHeader {
    return this.readHeader(buffer);
  }

  /**
   * 读取文件头
   */
  private readHeader(buffer: Buffer): VZIHeader {
    if (buffer.length < 256) {
      throw new Error('Invalid VZI file: too small for header');
    }

    let offset = 0;

    const magic = buffer.readUInt32LE(offset);
    offset += 4;

    if (magic !== 0x565a6932) {
      throw new Error(`Invalid VZI file: bad magic number ${magic.toString(16)}`);
    }

    const version = buffer.readUInt16LE(offset);
    offset += 2;

    const fileSize = buffer.readBigUInt64LE(offset);
    offset += 8;

    const elementCount = buffer.readUInt32LE(offset);
    offset += 4;

    const blockCount = buffer.readUInt32LE(offset);
    offset += 4;

    const metadataOffset = buffer.readBigUInt64LE(offset);
    offset += 8;

    const metadataLength = buffer.readUInt32LE(offset);
    offset += 4;

    const blockIndexOffset = buffer.readBigUInt64LE(offset);
    offset += 8;

    const blockIndexLength = buffer.readUInt32LE(offset);
    offset += 4;

    const dataOffset = buffer.readBigUInt64LE(offset);
    offset += 8;

    const checksum = buffer.slice(offset, offset + 32);
    offset += 32;

    const reserved = buffer.slice(offset, 256);

    return {
      magic,
      version,
      fileSize,
      elementCount,
      blockCount,
      metadataOffset,
      metadataLength,
      blockIndexOffset,
      blockIndexLength,
      dataOffset,
      checksum,
      reserved,
    };
  }

  /**
   * 读取块索引
   */
  private readBlockIndex(): BlockIndexEntry[] {
    if (!this.header) {
      throw new Error('Header not read');
    }

    const offset = Number(this.header.blockIndexOffset);
    const length = this.header.blockIndexLength;

    const indexBuffer = this.buffer.slice(offset, offset + length);
    return decode(indexBuffer) as BlockIndexEntry[];
  }

  /**
   * 读取元数据
   */
  private readMetadata(): VZIMetadata {
    const block = this.getBlockByType('metadata');
    if (!block) {
      throw new Error('Metadata block not found');
    }

    const decoded = decode(block.data) as VZIMetadata & {
      colorTokens?: ColorToken[];
      fontTokens?: FontToken[];
      layers?: Layer[];
      compatibility?: VersionCompatibility;
    };

    // 提取 colorTokens 和 fontTokens（如果存在）
    if (decoded.colorTokens) {
      this.colorTokens = decoded.colorTokens;
      delete decoded.colorTokens;
    }
    if (decoded.fontTokens) {
      this.fontTokens = decoded.fontTokens;
      delete decoded.fontTokens;
    }
    if (decoded.layers) {
      this.layers = decoded.layers;
      delete decoded.layers;
    }
    if (decoded.compatibility) {
      this.compatibility = decoded.compatibility;
      delete decoded.compatibility;
    }

    return decoded as VZIMetadata;
  }

  /**
   * 按类型获取块（带缓存）
   */
  private getBlockByType(type: string): { data: Uint8Array } | null {
    const entry = this.blockIndex.find((e) => e.type === type);
    if (!entry) {
      return null;
    }

    return this.getCachedBlock(entry);
  }

  /**
   * 按 ID 获取块（带缓存）
   */
  private getBlockById(id: string): { data: Uint8Array } | null {
    const entry = this.blockIndex.find((e) => e.id === id);
    if (!entry) {
      return null;
    }

    return this.getCachedBlock(entry);
  }

  /**
   * 按类型获取所有块
   */
  private getBlocksByType(type: string): Array<{ data: Uint8Array }> {
    const blocks: Array<{ data: Uint8Array }> = [];

    for (const entry of this.blockIndex) {
      if (entry.type === type) {
        const block = this.getCachedBlock(entry);
        if (block) {
          blocks.push(block);
        }
      }
    }

    return blocks;
  }

  /**
   * 获取缓存的块
   */
  private getCachedBlock(entry: BlockIndexEntry): { data: Uint8Array } | null {
    const cacheKey = entry.id;

    if (this.cacheDisabled()) {
      const data = this.readAndDecryptBlock(entry);
      return data ? { data } : null;
    }

    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached) {
      cached.accessCount++;
      cached.timestamp = Date.now();
      return { data: cached.data };
    }

    // 读取并解密块
    const data = this.readAndDecryptBlock(entry);
    if (!data) {
      return null;
    }

    // 添加到缓存
    this.addToCache(cacheKey, data);

    return { data };
  }

  /**
   * 读取并解密块（带错误恢复）
   */
  private readAndDecryptBlock(entry: BlockIndexEntry): Uint8Array | null {
    if (!this.header) {
      return null;
    }

    try {
      // 计算实际偏移量
      // metadata 块单独存储在 metadataOffset
      // 其他块存储在 dataOffset，但块索引中的 offset 包含了 metadata 的长度
      let offset: number;
      if (entry.type === 'metadata') {
        offset = Number(this.header.metadataOffset) + Number(entry.offset);
      } else {
        // 其他块的 offset 需要减去 metadata 的长度
        offset = Number(this.header.dataOffset) + Number(entry.offset) - this.header.metadataLength;
      }

      // 边界检查：确保偏移量和长度不越界
      if (offset < 0 || entry.compressedSize < 0 || offset + entry.compressedSize > this.buffer.length) {
        throw new Error(
          `Block ${entry.id} offset ${offset}+${entry.compressedSize} exceeds buffer size ${this.buffer.length}`
        );
      }

      const encryptedData = this.buffer.slice(offset, offset + entry.compressedSize);

      // 验证校验和
      if (this.options.verifyChecksums) {
        const computedChecksum = this.computeChecksum(encryptedData);
        if (!this.checksumEquals(computedChecksum, entry.checksum)) {
          if (this.options.enableErrorRecovery) {
            this.recordError(entry.id, entry.type, 'checksum_mismatch',
              `Checksum mismatch for block ${entry.id}`, false);
            this.failedBlocks++;
            return null;
          }
          throw new Error(`Checksum mismatch for block ${entry.id}`);
        }
      }

      let decompressed: Buffer;
      try {
        // 未加密块直接尝试 Brotli 解压
        decompressed = brotliDecompressSync(Buffer.from(encryptedData));
      } catch {
        if (!this.options.decryptionKey) {
          throw new Error(`Encrypted block ${entry.id} requires decryptionKey`);
        }

        // 加密块：先解密再解压
        const decrypted = this.decrypt(encryptedData);
        decompressed = brotliDecompressSync(Buffer.from(decrypted));
      }

      // 防解压炸弹：校验解压后大小上限
      if (decompressed.length > this.options.maxDecompressedBlockBytes) {
        throw new Error(
          `Block ${entry.id} decompressed size ${decompressed.length} exceeds limit ` +
          `${this.options.maxDecompressedBlockBytes} bytes`
        );
      }

      // 如果编码器写入了真实 uncompressedSize，则做一致性校验（0 表示旧版跳过）
      if (entry.uncompressedSize > 0 && decompressed.length !== entry.uncompressedSize) {
        throw new Error(
          `Block ${entry.id} decompressed size mismatch: expected ${entry.uncompressedSize}, got ${decompressed.length}`
        );
      }

      this.successfulBlocks++;
      return decompressed;
    } catch (error) {
      if (this.options.enableErrorRecovery) {
        const errorType: BlockErrorType = error instanceof Error && error.message.includes('checksum')
          ? 'checksum_mismatch'
          : error instanceof Error && error.message.includes('decrypt')
          ? 'decryption_failed'
          : error instanceof Error && error.message.includes('decompress')
          ? 'decompression_failed'
          : 'corrupted_data';

        this.recordError(entry.id, entry.type, errorType,
          `Failed to read block ${entry.id}: ${error instanceof Error ? error.message : String(error)}`, false);
        this.failedBlocks++;
        return null;
      }
      throw error;
    }
  }

  /**
   * 记录错误
   */
  private recordError(
    blockId: string,
    blockType: BlockType,
    errorType: BlockErrorType,
    message: string,
    fatal: boolean
  ): void {
    this.errors.push({
      blockId,
      blockType,
      errorType,
      message,
      fatal,
    });
  }

  /**
   * 获取默认元数据
   */
  private getDefaultMetadata(): VZIMetadata {
    return {
      name: 'Untitled',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      viewportWidth: 1920,
      viewportHeight: 1080,
      minReaderVersion: '2.0.0',
      features: [],
    };
  }

  private getDefaultCompatibility(): VersionCompatibility {
    return {
      minReaderVersion: '2.0.0',
      formatVersion: '2.0.0',
      features: [],
    };
  }

  /**
   * 获取空内容（用于错误恢复时的降级处理）
   */
  private getEmptyContent(): VZIContent {
    const defaultHeader: VZIHeader = {
      magic: 0x565a6932,
      version: 0x0002,
      fileSize: BigInt(0),
      elementCount: 0,
      blockCount: 0,
      metadataOffset: BigInt(0),
      metadataLength: 0,
      blockIndexOffset: BigInt(0),
      blockIndexLength: 0,
      dataOffset: BigInt(0),
      checksum: new Uint8Array(32),
      reserved: new Uint8Array(168),
    };

    return {
      header: this.header || defaultHeader,
      metadata: this.getDefaultMetadata(),
      elements: new Map(),
      sharedStyles: new Map(),
      spatialIndex: {
        rootBlockId: '',
        blocks: new Map(),
        maxDepth: 0,
      },
      colorTokens: [],
      fontTokens: [],
      annotations: [],
      images: new Map(),
      layers: [],
      compatibility: this.getDefaultCompatibility(),
    };
  }

  /**
   * 读取元素（带错误恢复）
   */
  private readElementsWithRecovery(): Map<string, IRElement> {
    const elements = new Map<string, IRElement>();

    try {
      const elementBlocks = this.getBlocksByType('elements');

      for (const block of elementBlocks) {
        try {
          const chunkElements = decode(block.data) as Record<string, IRElement>;
          for (const [id, element] of Object.entries(chunkElements)) {
            elements.set(id, element);
          }
        } catch (error) {
          if (this.options.enableErrorRecovery) {
            this.recordError('elements', 'elements', 'decode_failed',
              `Failed to decode elements block: ${error instanceof Error ? error.message : String(error)}`, false);
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      if (!this.options.enableErrorRecovery) {
        throw error;
      }
    }

    return elements;
  }

  /**
   * 读取共享样式（带错误恢复）
   */
  private readSharedStylesWithRecovery(): Map<string, SharedStyle> {
    const styles = new Map<string, SharedStyle>();

    try {
      const styleBlock = this.getBlockByType('styles');
      if (styleBlock) {
        const styleData = decode(styleBlock.data) as Record<string, SharedStyle>;
        for (const [id, style] of Object.entries(styleData)) {
          styles.set(id, style);
        }
      }
    } catch (error) {
      if (this.options.enableErrorRecovery) {
        this.recordError('styles', 'styles', 'decode_failed',
          `Failed to decode styles: ${error instanceof Error ? error.message : String(error)}`, false);
      } else {
        throw error;
      }
    }

    return styles;
  }

  /**
   * 读取空间索引（带错误恢复）
   */
  private readSpatialIndexWithRecovery(): QuadTreeIndex {
    try {
      const spatialBlock = this.getBlockByType('spatial');
      if (!spatialBlock) {
        return {
          rootBlockId: '',
          blocks: new Map(),
          maxDepth: 0,
        };
      }

      const indexData = decode(spatialBlock.data) as {
        rootBlockId?: unknown;
        maxDepth?: unknown;
        blocks: Record<string, unknown>;
      };
      const rootBlockId = typeof indexData.rootBlockId === 'string'
        ? indexData.rootBlockId
        : Object.keys(indexData.blocks)[0] || '';
      const maxDepth = typeof indexData.maxDepth === 'number'
        ? indexData.maxDepth
        : 10;

      return {
        rootBlockId,
        blocks: new Map(Object.entries(indexData.blocks)) as Map<string, SpatialBlock>,
        maxDepth,
      };
    } catch (error) {
      if (this.options.enableErrorRecovery) {
        this.recordError('spatial', 'spatial', 'decode_failed',
          `Failed to decode spatial index: ${error instanceof Error ? error.message : String(error)}`, false);
        return {
          rootBlockId: '',
          blocks: new Map(),
          maxDepth: 0,
        };
      }
      throw error;
    }
  }

  /**
   * 读取颜色令牌（带错误恢复）
   */
  private readColorTokensWithRecovery(): ColorToken[] {
    // 从 metadata 中读取（已在 readMetadata 中提取）
    return this.colorTokens;
  }

  /**
   * 读取字体令牌（带错误恢复）
   */
  private readFontTokensWithRecovery(): FontToken[] {
    // 从 metadata 中读取（已在 readMetadata 中提取）
    return this.fontTokens;
  }

  /**
   * 读取标注（带错误恢复）
   */
  private readAnnotationsWithRecovery(): Annotation[] {
    try {
      const annotationBlock = this.getBlockByType('annotations');
      if (!annotationBlock) {
        return [];
      }

      return decode(annotationBlock.data) as Annotation[];
    } catch (error) {
      if (this.options.enableErrorRecovery) {
        this.recordError('annotations', 'annotations', 'decode_failed',
          `Failed to decode annotations: ${error instanceof Error ? error.message : String(error)}`, false);
        return [];
      }
      throw error;
    }
  }

  /**
   * 读取图片资源（带错误恢复）
   */
  private readImagesWithRecovery(): Map<string, ImageAsset> {
    const images = new Map<string, ImageAsset>();

    try {
      const resourceBlock = this.getBlockByType('resources');
      if (resourceBlock) {
        const imageData = decode(resourceBlock.data) as Record<string, ImageAsset>;
        for (const [id, asset] of Object.entries(imageData)) {
          images.set(id, asset);
        }
      }
    } catch (error) {
      if (this.options.enableErrorRecovery) {
        this.recordError('resources', 'resources', 'decode_failed',
          `Failed to decode images: ${error instanceof Error ? error.message : String(error)}`, false);
      } else {
        throw error;
      }
    }

    return images;
  }

  /**
   * 读取图层（带错误恢复）
   */
  private readLayersWithRecovery(): Layer[] {
    return this.layers;
  }

  /**
   * 读取版本兼容性信息（带错误恢复）
   */
  private readCompatibilityWithRecovery(): VersionCompatibility {
    return this.compatibility;
  }

  /**
   * 解密数据
   */
  private decrypt(data: Uint8Array): Uint8Array {
    if (data.length < 28) {
      throw new Error('Encrypted payload is too short');
    }

    if (!this.options.decryptionKey) {
      throw new Error('decryptionKey is required for encrypted payload');
    }

    const iv = data.slice(0, 12);
    const authTag = data.slice(12, 28);
    const encrypted = data.slice(28);

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.options.decryptionKey,
      iv
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
  }

  /**
   * 计算校验和
   */
  private computeChecksum(data: Uint8Array): Uint8Array {
    const hash = createHash('sha256').update(data).digest();
    return hash.slice(0, 16);
  }

  /**
   * 比较校验和
   */
  private checksumEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * 验证文件级 checksum（SHA-256）
   * 全零 checksum 表示旧版文件，跳过校验并输出 warn
   */
  private verifyFileChecksum(buffer: Buffer, header: VZIHeader): void {
    const CHECKSUM_OFFSET = 54;
    const CHECKSUM_SIZE = 32;

    const storedChecksum = Buffer.from(header.checksum);
    const isAllZero = storedChecksum.every((b) => b === 0);
    if (isAllZero) {
      // 旧版文件，无文件级 checksum，跳过校验
      console.warn('[vzi-decoder] File-level checksum is missing (legacy file). Skipping file integrity check.');
      return;
    }

    // 将 checksum 字段本身清零后计算 SHA-256
    const forChecksum = Buffer.from(buffer);
    forChecksum.fill(0, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_SIZE);
    const computed = createHash('sha256').update(forChecksum).digest();

    if (!this.checksumEquals(computed, storedChecksum)) {
      const msg = 'File integrity check failed: file-level checksum mismatch. File may be corrupted or tampered.';
      if (this.options.enableErrorRecovery) {
        console.warn(`[vzi-decoder] ${msg}`);
        this.recordError('file-header', 'metadata', 'checksum_mismatch', msg, false);
      } else {
        throw new Error(msg);
      }
    }
  }

  /**
   * 验证 header 中的偏移量不越界
   */
  private validateHeaderOffsets(header: VZIHeader, bufferLength: number): void {
    const metadataOffset = Number(header.metadataOffset);
    const metadataEnd = metadataOffset + header.metadataLength;
    if (metadataOffset < 256 || metadataEnd > bufferLength) {
      throw new Error(
        `Invalid metadataOffset: ${metadataOffset}+${header.metadataLength} out of bounds (buffer: ${bufferLength})`
      );
    }

    const blockIndexOffset = Number(header.blockIndexOffset);
    const blockIndexEnd = blockIndexOffset + header.blockIndexLength;
    if (blockIndexOffset < 256 || blockIndexEnd > bufferLength) {
      throw new Error(
        `Invalid blockIndexOffset: ${blockIndexOffset}+${header.blockIndexLength} out of bounds (buffer: ${bufferLength})`
      );
    }

    const dataOffset = Number(header.dataOffset);
    if (dataOffset < 256 || dataOffset > bufferLength) {
      throw new Error(
        `Invalid dataOffset: ${dataOffset} out of bounds (buffer: ${bufferLength})`
      );
    }
  }

  private cacheDisabled(): boolean {
    return this.options.cacheSize <= 0 || this.options.maxMemoryMB <= 0;
  }

  private getMaxCacheBytes(): number {
    return Math.floor(this.options.maxMemoryMB * 1024 * 1024);
  }

  /**
   * 添加到缓存
   */
  private addToCache(key: string, data: Uint8Array): void {
    if (this.cacheDisabled()) {
      return;
    }

    const maxCacheBytes = this.getMaxCacheBytes();
    const size = data.byteLength;

    if (size > maxCacheBytes) {
      return;
    }

    const existing = this.cache.get(key);
    if (existing) {
      this.cacheBytes -= existing.size;
      this.cache.delete(key);
      this.cacheOrder = this.cacheOrder.filter((cacheKey) => cacheKey !== key);
    }

    while (
      this.cache.size >= this.options.cacheSize ||
      this.cacheBytes + size > maxCacheBytes
    ) {
      const before = this.cache.size;
      this.evictLRU();
      if (this.cache.size === before) {
        // 没有可驱逐项，跳出避免死循环
        break;
      }
    }

    if (
      this.cache.size >= this.options.cacheSize ||
      this.cacheBytes + size > maxCacheBytes
    ) {
      return;
    }

    this.cache.set(key, {
      data,
      size,
      timestamp: Date.now(),
      accessCount: 1,
    });
    this.cacheOrder.push(key);
    this.cacheBytes += size;
  }

  /**
   * 移除最久未使用的缓存项
   */
  private evictLRU(): void {
    if (this.cacheOrder.length === 0) return;

    // 找到最久未使用的项
    let oldestKey = this.cacheOrder[0];
    let oldestTime = this.cache.get(oldestKey)?.timestamp || 0;

    for (const key of this.cacheOrder) {
      const item = this.cache.get(key);
      if (item && item.timestamp < oldestTime) {
        oldestTime = item.timestamp;
        oldestKey = key;
      }
    }

    const evicted = this.cache.get(oldestKey);
    this.cache.delete(oldestKey);
    this.cacheOrder = this.cacheOrder.filter((k) => k !== oldestKey);
    if (evicted) {
      this.cacheBytes = Math.max(0, this.cacheBytes - evicted.size);
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheOrder = [];
    this.cacheBytes = 0;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    const totalAccess = Array.from(this.cache.values()).reduce(
      (sum, item) => sum + item.accessCount,
      0
    );

    return {
      size: this.cache.size,
      maxSize: this.options.cacheSize,
      hitRate: totalAccess > 0 ? (totalAccess - this.cacheOrder.length) / totalAccess : 0,
    };
  }
}
