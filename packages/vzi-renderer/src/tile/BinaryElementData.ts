/**
 * 二进制元素数据存储
 *
 * 使用 ArrayBuffer 存储元素数据，减少内存占用和序列化开销
 * 适用于大型设计稿（1000+ 元素）场景
 */

import type { IRElement } from '@vzi-core/types'
import type { Rect } from './types'

/**
 * 元素类型枚举（用于二进制编码）
 */
export enum ElementType {
  CONTAINER = 0,
  TEXT = 1,
  IMAGE = 2,
  BUTTON = 3,
  INPUT = 4,
  LINK = 5,
}

/**
 * 元素标志位（使用位运算）
 */
export enum ElementFlags {
  HAS_STROKES = 1 << 0, // 0x01
  HAS_SHADOWS = 1 << 1, // 0x02
  HAS_BLUR = 1 << 2, // 0x04
  HAS_TRANSFORM = 1 << 3, // 0x08
  HAS_ANIMATIONS = 1 << 4, // 0x10
  IS_VISIBLE = 1 << 5, // 0x20
}

/**
 * 二进制元素数据
 *
 * 固定布局（128 字节/元素）：
 * - 0-15: element_id (16 bytes, UUID as hex string)
 * - 16-19: type (4 bytes, u32)
 * - 20-23: bounds.x (4 bytes, f32)
 * - 24-27: bounds.y (4 bytes, f32)
 * - 28-31: bounds.width (4 bytes, f32)
 * - 32-35: bounds.height (4 bytes, f32)
 * - 36-39: opacity (4 bytes, f32)
 * - 40-43: flags (4 bytes, u32)
 * - 44-127: 保留/扩展字段 (84 bytes)
 */
export class BinaryElementData {
  private buffer: ArrayBuffer
  private view: DataView
  private elementCount: number
  private idToIndex: Map<string, number>

  // 每个元素的固定大小（字节）
  private readonly ELEMENT_SIZE = 128

  // 字段偏移量
  private readonly OFFSET_ID = 0
  private readonly OFFSET_TYPE = 16
  private readonly OFFSET_BOUNDS_X = 20
  private readonly OFFSET_BOUNDS_Y = 24
  private readonly OFFSET_BOUNDS_WIDTH = 28
  private readonly OFFSET_BOUNDS_HEIGHT = 32
  private readonly OFFSET_OPACITY = 36
  private readonly OFFSET_FLAGS = 40

  constructor(elements: Map<string, IRElement>) {
    this.elementCount = elements.size
    this.buffer = new ArrayBuffer(this.elementCount * this.ELEMENT_SIZE)
    this.view = new DataView(this.buffer)
    this.idToIndex = new Map()

    // 序列化元素数据
    let index = 0
    for (const [id, element] of elements) {
      this.writeElement(index, id, element)
      this.idToIndex.set(id, index)
      index++
    }
  }

  /**
   * 写入元素数据到 ArrayBuffer
   */
  private writeElement(index: number, id: string, element: IRElement): void {
    const offset = index * this.ELEMENT_SIZE

    // 写入 ID（16 字节，使用 UTF-8 编码的前 16 字节）
    this.writeString(offset + this.OFFSET_ID, id, 16)

    // 写入类型
    const type = this.encodeElementType(element.type)
    this.view.setUint32(offset + this.OFFSET_TYPE, type, true)

    // 写入边界
    this.view.setFloat32(offset + this.OFFSET_BOUNDS_X, element.bounds.x, true)
    this.view.setFloat32(offset + this.OFFSET_BOUNDS_Y, element.bounds.y, true)
    this.view.setFloat32(offset + this.OFFSET_BOUNDS_WIDTH, element.bounds.width, true)
    this.view.setFloat32(offset + this.OFFSET_BOUNDS_HEIGHT, element.bounds.height, true)

    // 写入透明度
    const opacity = element.styles.opacity ? parseFloat(String(element.styles.opacity)) : 1.0
    this.view.setFloat32(offset + this.OFFSET_OPACITY, opacity, true)

    // 写入标志位
    const flags = this.encodeFlags(element)
    this.view.setUint32(offset + this.OFFSET_FLAGS, flags, true)
  }

  /**
   * 将字符串写入 ArrayBuffer（固定长度）
   */
  private writeString(offset: number, str: string, maxLength: number): void {
    const encoder = new TextEncoder()
    const encoded = encoder.encode(str.slice(0, maxLength))
    const bytes = new Uint8Array(this.buffer, offset, maxLength)
    bytes.set(encoded)
  }

  /**
   * 从 ArrayBuffer 读取字符串
   */
  private readString(offset: number, length: number): string {
    const bytes = new Uint8Array(this.buffer, offset, length)
    // 找到第一个 0 字节（字符串结束符）
    let end = 0
    while (end < length && bytes[end] !== 0) {
      end++
    }
    const decoder = new TextDecoder()
    return decoder.decode(bytes.slice(0, end))
  }

  /**
   * 编码元素类型
   */
  private encodeElementType(type: string): number {
    switch (type) {
      case 'container':
        return ElementType.CONTAINER
      case 'text':
        return ElementType.TEXT
      case 'image':
        return ElementType.IMAGE
      case 'button':
        return ElementType.BUTTON
      case 'input':
        return ElementType.INPUT
      case 'link':
        return ElementType.LINK
      default:
        return ElementType.CONTAINER
    }
  }

  /**
   * 解码元素类型
   */
  private decodeElementType(type: number): string {
    switch (type) {
      case ElementType.CONTAINER:
        return 'container'
      case ElementType.TEXT:
        return 'text'
      case ElementType.IMAGE:
        return 'image'
      case ElementType.BUTTON:
        return 'button'
      case ElementType.INPUT:
        return 'input'
      case ElementType.LINK:
        return 'link'
      default:
        return 'container'
    }
  }

  /**
   * 编码元素标志位
   */
  private encodeFlags(element: IRElement): number {
    let flags = 0

    // 检查是否有描边
    if (element.styles.border || element.styles.borderWidth) {
      flags |= ElementFlags.HAS_STROKES
    }

    // 检查是否有阴影
    if (element.effects?.shadows && element.effects.shadows.length > 0) {
      flags |= ElementFlags.HAS_SHADOWS
    }

    // 检查是否有模糊
    if (element.styles.filter && String(element.styles.filter).includes('blur')) {
      flags |= ElementFlags.HAS_BLUR
    }

    // 检查是否有变换
    if (element.transform || element.styles.transform) {
      flags |= ElementFlags.HAS_TRANSFORM
    }

    // 检查是否有动画
    if (element.animations) {
      flags |= ElementFlags.HAS_ANIMATIONS
    }

    // 检查是否可见
    const opacity = element.styles.opacity ? parseFloat(String(element.styles.opacity)) : 1.0
    const display = element.styles.display
    if (opacity > 0 && display !== 'none') {
      flags |= ElementFlags.IS_VISIBLE
    }

    return flags
  }

  /**
   * 获取元素边界
   */
  getElementBounds(index: number): Rect {
    if (index < 0 || index >= this.elementCount) {
      throw new Error(`Index out of bounds: ${index}`)
    }

    const offset = index * this.ELEMENT_SIZE
    return {
      x: this.view.getFloat32(offset + this.OFFSET_BOUNDS_X, true),
      y: this.view.getFloat32(offset + this.OFFSET_BOUNDS_Y, true),
      width: this.view.getFloat32(offset + this.OFFSET_BOUNDS_WIDTH, true),
      height: this.view.getFloat32(offset + this.OFFSET_BOUNDS_HEIGHT, true),
    }
  }

  /**
   * 获取元素 ID
   */
  getElementId(index: number): string {
    if (index < 0 || index >= this.elementCount) {
      throw new Error(`Index out of bounds: ${index}`)
    }

    const offset = index * this.ELEMENT_SIZE
    return this.readString(offset + this.OFFSET_ID, 16)
  }

  /**
   * 获取元素类型
   */
  getElementType(index: number): string {
    if (index < 0 || index >= this.elementCount) {
      throw new Error(`Index out of bounds: ${index}`)
    }

    const offset = index * this.ELEMENT_SIZE
    const type = this.view.getUint32(offset + this.OFFSET_TYPE, true)
    return this.decodeElementType(type)
  }

  /**
   * 获取元素透明度
   */
  getOpacity(index: number): number {
    if (index < 0 || index >= this.elementCount) {
      throw new Error(`Index out of bounds: ${index}`)
    }

    const offset = index * this.ELEMENT_SIZE
    return this.view.getFloat32(offset + this.OFFSET_OPACITY, true)
  }

  /**
   * 检查是否有描边
   */
  hasStrokes(index: number): boolean {
    return this.hasFlag(index, ElementFlags.HAS_STROKES)
  }

  /**
   * 检查是否有阴影
   */
  hasShadows(index: number): boolean {
    return this.hasFlag(index, ElementFlags.HAS_SHADOWS)
  }

  /**
   * 检查是否有模糊
   */
  hasBlur(index: number): boolean {
    return this.hasFlag(index, ElementFlags.HAS_BLUR)
  }

  /**
   * 检查是否有变换
   */
  hasTransform(index: number): boolean {
    return this.hasFlag(index, ElementFlags.HAS_TRANSFORM)
  }

  /**
   * 检查是否有动画
   */
  hasAnimations(index: number): boolean {
    return this.hasFlag(index, ElementFlags.HAS_ANIMATIONS)
  }

  /**
   * 检查是否可见
   */
  isVisible(index: number): boolean {
    return this.hasFlag(index, ElementFlags.IS_VISIBLE)
  }

  /**
   * 检查标志位
   */
  private hasFlag(index: number, flag: ElementFlags): boolean {
    if (index < 0 || index >= this.elementCount) {
      throw new Error(`Index out of bounds: ${index}`)
    }

    const offset = index * this.ELEMENT_SIZE
    const flags = this.view.getUint32(offset + this.OFFSET_FLAGS, true)
    return (flags & flag) !== 0
  }

  /**
   * 获取所有元素边界
   */
  getAllBounds(): Rect[] {
    const bounds: Rect[] = []
    for (let i = 0; i < this.elementCount; i++) {
      bounds.push(this.getElementBounds(i))
    }
    return bounds
  }

  /**
   * 按类型过滤元素
   */
  filterByType(type: string): number[] {
    const indices: number[] = []
    const targetType = this.encodeElementType(type)

    for (let i = 0; i < this.elementCount; i++) {
      const offset = i * this.ELEMENT_SIZE
      const elementType = this.view.getUint32(offset + this.OFFSET_TYPE, true)
      if (elementType === targetType) {
        indices.push(i)
      }
    }

    return indices
  }

  /**
   * 通过 ID 查找索引
   */
  getIndexById(id: string): number | undefined {
    return this.idToIndex.get(id)
  }

  /**
   * 获取元素数量
   */
  getElementCount(): number {
    return this.elementCount
  }

  /**
   * 获取内存占用（字节）
   */
  getMemoryUsage(): number {
    return this.buffer.byteLength
  }
}
