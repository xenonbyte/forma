/**
 * VZI 2.0 编码器
 *
 * 任务 3.13-3.19: 实现文件写入、块编码、序列化、压缩、加密
 */

import { createHash, createCipheriv, randomBytes } from "crypto";
import { brotliCompressSync, constants } from "zlib";
import { encode } from "msgpackr";
import type {
  VZIHeader,
  VZIMetadata,
  VZIContent,
  BlockIndexEntry,
  BlockType,
  Layer,
  VersionCompatibility,
} from "./types";
import { VZI_MAGIC, VZI_VERSION } from "./types";

/**
 * 编码器配置
 */
export interface VZIEncoderOptions {
  /** 压缩级别 (0-11, 默认 4) */
  compressionLevel?: number;
  /** 是否加密 */
  encrypt?: boolean;
  /** 加密密钥（32 字节） */
  encryptionKey?: Uint8Array;
  /** 是否启用四叉树空间索引 */
  enableSpatialIndex?: boolean;
  /** 最大块大小（字节） */
  maxBlockSize?: number;
}

/**
 * 块数据容器
 */
interface BlockData {
  type: BlockType;
  id: string;
  data: Uint8Array;
}

interface ResolvedVZIEncoderOptions {
  compressionLevel: number;
  encrypt: boolean;
  encryptionKey?: Uint8Array;
  enableSpatialIndex: boolean;
  maxBlockSize: number;
}

/**
 * VZI 2.0 编码器
 */
export class VZIEncoder {
  private options: ResolvedVZIEncoderOptions;
  private blocks: BlockData[] = [];
  /** 记录每个块的原始（压缩前）大小，用于写入 uncompressedSize */
  private uncompressedSizes: Map<string, number> = new Map();

  constructor(options: VZIEncoderOptions = {}) {
    const resolved: ResolvedVZIEncoderOptions = {
      compressionLevel: 4,
      encrypt: false,
      encryptionKey: options.encryptionKey,
      enableSpatialIndex: true,
      maxBlockSize: 1024 * 1024, // 1MB
      ...options,
    };

    if (!Number.isFinite(resolved.maxBlockSize) || resolved.maxBlockSize <= 0) {
      throw new Error("VZIEncoder maxBlockSize must be a positive number");
    }

    if (resolved.encrypt) {
      if (!resolved.encryptionKey || resolved.encryptionKey.length !== 32) {
        throw new Error("VZIEncoder requires a 32-byte encryptionKey when encrypt=true");
      }

      let allZero = true;
      for (const byte of resolved.encryptionKey) {
        if (byte !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) {
        throw new Error("VZIEncoder encryptionKey must not be an all-zero key when encrypt=true");
      }
    }

    this.options = resolved;
  }

  /**
   * 编码 VZI 内容为二进制格式
   */
  encode(content: VZIContent): Uint8Array {
    this.blocks = [];

    // 1. 编码元数据块（包含 colorTokens / fontTokens / layers / compatibility）
    this.encodeMetadata(
      content.metadata,
      content.colorTokens,
      content.fontTokens,
      content.layers,
      content.compatibility,
    );

    // 2. 编码元素块
    this.encodeElements(content.elements);

    // 3. 编码样式块
    this.encodeStyles(content.sharedStyles);

    // 4. 编码资源块
    this.encodeResources(content.images);

    // 5. 编码标注块
    this.encodeAnnotations(content.annotations);

    // 6. 编码空间索引块
    if (this.options.enableSpatialIndex) {
      this.encodeSpatialIndex(content.spatialIndex);
    }

    // 7. 构建块索引
    const blockIndex = this.buildBlockIndex();

    // 8. 合并所有数据
    return this.buildFinalOutput(content, blockIndex);
  }

  /**
   * 编码元数据块
   */
  private encodeMetadata(
    metadata: VZIMetadata,
    colorTokens: unknown[],
    fontTokens: unknown[],
    layers: Layer[],
    compatibility: VersionCompatibility,
  ): void {
    const extendedMetadata = {
      ...metadata,
      colorTokens,
      fontTokens,
      layers,
      compatibility,
    };
    this.pushBlock("metadata", "metadata", encode(extendedMetadata));
  }

  /**
   * 编码元素块
   */
  private encodeElements(elements: Map<string, unknown>): void {
    // 将元素分组到多个块中
    const elementArray = Array.from(elements.entries());
    const chunkSize = 100; // 每块 100 个元素

    for (let i = 0; i < elementArray.length; i += chunkSize) {
      const chunk = elementArray.slice(i, i + chunkSize);
      const chunkData = Object.fromEntries(chunk);
      const encoded = encode(chunkData);

      this.pushBlock("elements", `elements_${Math.floor(i / chunkSize)}`, encoded);
    }
  }

  /**
   * 编码样式块
   */
  private encodeStyles(styles: Map<string, unknown>): void {
    if (styles.size === 0) return;

    const stylesData = Object.fromEntries(styles);
    const encoded = encode(stylesData);

    this.pushBlock("styles", "shared_styles", encoded);
  }

  /**
   * 编码资源块
   */
  private encodeResources(resources: Map<string, unknown>): void {
    if (resources.size === 0) return;

    const resourcesData = Object.fromEntries(resources);
    const encoded = encode(resourcesData);

    this.pushBlock("resources", "images", encoded);
  }

  /**
   * 编码标注块
   */
  private encodeAnnotations(annotations: unknown[]): void {
    if (annotations.length === 0) return;

    const encoded = encode(annotations);

    this.pushBlock("annotations", "annotations", encoded);
  }

  /**
   * 编码空间索引块
   */
  private encodeSpatialIndex(spatialIndex: {
    rootBlockId: string;
    blocks: Map<string, unknown>;
    maxDepth: number;
  }): void {
    if (!spatialIndex || spatialIndex.blocks.size === 0) return;

    const indexData = {
      rootBlockId: spatialIndex.rootBlockId,
      maxDepth: spatialIndex.maxDepth,
      blocks: Object.fromEntries(spatialIndex.blocks),
    };
    const encoded = encode(indexData);

    this.pushBlock("spatial", "spatial_index", encoded);
  }

  private pushBlock(type: BlockType, id: string, payload: Uint8Array): void {
    this.uncompressedSizes.set(id, payload.length);
    const data = this.compressAndEncrypt(payload);
    this.assertBlockSize(id, data.length);

    this.blocks.push({
      type,
      id,
      data,
    });
  }

  private assertBlockSize(blockId: string, size: number): void {
    if (size > this.options.maxBlockSize) {
      throw new Error(`Block ${blockId} exceeds maxBlockSize (${size} > ${this.options.maxBlockSize})`);
    }
  }

  /**
   * 压缩并加密数据
   */
  private compressAndEncrypt(data: Uint8Array): Uint8Array {
    // Brotli 压缩（使用 Node.js 内置 zlib）
    const compressed = brotliCompressSync(Buffer.from(data), {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: this.options.compressionLevel,
      },
    });

    if (!this.options.encrypt) {
      return compressed;
    }

    // AES-256-GCM 加密
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.options.encryptionKey!, iv);

    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);

    const authTag = cipher.getAuthTag();

    // 返回格式: IV (12) + AuthTag (16) + EncryptedData
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * 构建块索引
   */
  private buildBlockIndex(): BlockIndexEntry[] {
    const index: BlockIndexEntry[] = [];
    let offset = 0;

    for (const block of this.blocks) {
      const checksum = this.computeChecksum(block.data);

      index.push({
        type: block.type,
        id: block.id,
        offset: BigInt(offset),
        compressedSize: block.data.length,
        uncompressedSize: this.uncompressedSizes.get(block.id) ?? 0,
        checksum,
      });

      offset += block.data.length;
    }

    return index;
  }

  /**
   * 计算校验和
   */
  private computeChecksum(data: Uint8Array): Uint8Array {
    const hash = createHash("sha256").update(data).digest();
    return hash.slice(0, 16); // 取前 16 字节
  }

  /**
   * 构建最终输出
   */
  private buildFinalOutput(content: VZIContent, blockIndex: BlockIndexEntry[]): Uint8Array {
    // 计算各部分大小
    const headerSize = 256;
    const metadataOffset = headerSize;
    const metadataBlock = this.getBlockData("metadata")!;
    const encodedBlockIndex = encode(blockIndex);
    const blockIndexOffset = metadataOffset + metadataBlock.data.length;
    const dataOffset = blockIndexOffset + encodedBlockIndex.length;

    // 计算总大小
    let totalSize = dataOffset;
    for (const block of this.blocks) {
      if (block.type !== "metadata") {
        totalSize += block.data.length;
      }
    }

    // 构建文件头（checksum 先留全零，下方回填）
    const header: VZIHeader = {
      magic: VZI_MAGIC,
      version: VZI_VERSION,
      fileSize: BigInt(totalSize),
      elementCount: content.elements.size,
      blockCount: this.blocks.length,
      metadataOffset: BigInt(metadataOffset),
      metadataLength: metadataBlock.data.length,
      blockIndexOffset: BigInt(blockIndexOffset),
      blockIndexLength: encodedBlockIndex.length,
      dataOffset: BigInt(dataOffset),
      checksum: new Uint8Array(32),
      reserved: new Uint8Array(168),
    };

    // 序列化文件头
    const headerBuffer = this.serializeHeader(header);

    // 合并所有数据
    const parts: Uint8Array[] = [headerBuffer];
    parts.push(metadataBlock.data);
    parts.push(encodedBlockIndex);
    for (const block of this.blocks) {
      if (block.type !== "metadata") {
        parts.push(block.data);
      }
    }

    const output = Buffer.concat(parts);

    // 回填文件级 checksum（SHA-256，将 checksum 字段本身置零后计算）
    // checksum 字段在 header 中的偏移量为 54（固定）
    const CHECKSUM_OFFSET = 54;
    const CHECKSUM_SIZE = 32;
    const forChecksumBuffer = Buffer.from(output);
    forChecksumBuffer.fill(0, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_SIZE);
    const fileChecksum = createHash("sha256").update(forChecksumBuffer).digest();
    fileChecksum.copy(output, CHECKSUM_OFFSET, 0, CHECKSUM_SIZE);

    return output;
  }

  /**
   * 序列化文件头
   */
  private serializeHeader(header: VZIHeader): Buffer {
    const buffer = Buffer.alloc(256);
    let offset = 0;

    // magic (4 bytes)
    buffer.writeUInt32LE(header.magic, offset);
    offset += 4;

    // version (2 bytes)
    buffer.writeUInt16LE(header.version, offset);
    offset += 2;

    // fileSize (8 bytes)
    buffer.writeBigUInt64LE(header.fileSize, offset);
    offset += 8;

    // elementCount (4 bytes)
    buffer.writeUInt32LE(header.elementCount, offset);
    offset += 4;

    // blockCount (4 bytes)
    buffer.writeUInt32LE(header.blockCount, offset);
    offset += 4;

    // metadataOffset (8 bytes)
    buffer.writeBigUInt64LE(header.metadataOffset, offset);
    offset += 8;

    // metadataLength (4 bytes)
    buffer.writeUInt32LE(header.metadataLength, offset);
    offset += 4;

    // blockIndexOffset (8 bytes)
    buffer.writeBigUInt64LE(header.blockIndexOffset, offset);
    offset += 8;

    // blockIndexLength (4 bytes)
    buffer.writeUInt32LE(header.blockIndexLength, offset);
    offset += 4;

    // dataOffset (8 bytes)
    buffer.writeBigUInt64LE(header.dataOffset, offset);
    offset += 8;

    // checksum (32 bytes)
    buffer.set(header.checksum, offset);
    offset += 32;

    // reserved (168 bytes) - 已经是零填充

    return buffer;
  }

  /**
   * 获取指定类型的块数据
   */
  private getBlockData(type: BlockType): BlockData | undefined {
    return this.blocks.find((b) => b.type === type);
  }

  /**
   * 获取编码统计信息
   */
  getStats(): {
    blockCount: number;
    totalSize: number;
    compressionRatio: number;
  } {
    const totalSize = this.blocks.reduce((sum, block) => sum + block.data.length, 0);

    return {
      blockCount: this.blocks.length,
      totalSize,
      compressionRatio: 0, // 需要原始大小来计算
    };
  }
}
