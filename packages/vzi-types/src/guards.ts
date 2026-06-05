import Ajv from "ajv";
import { irElementSchema, irSchema } from "./schema";
import type { IRElement, IntermediateRepresentation } from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateElement = ajv.compile(irElementSchema);
const validateIRSchema = ajv.compile(irSchema);

export function isIRElement(value: unknown): value is IRElement {
  return validateElement(value);
}

export function isValidIR(value: unknown): value is IntermediateRepresentation {
  return validateIRSchema(value);
}

/**
 * 获取最近一次 isIRElement() 调用的验证错误。
 * 传入 value 时会先执行验证再读取错误，避免并发场景下读到其他调用的残留状态。
 */
export function getIRElementValidationErrors(value?: unknown): string[] {
  if (value !== undefined) {
    validateElement(value);
  }
  if (!validateElement.errors) {
    return [];
  }
  return validateElement.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
}

/**
 * 获取最近一次 isValidIR() 调用的验证错误。
 * 传入 value 时会先执行验证再读取错误，避免并发场景下读到其他调用的残留状态。
 */
export function getIRValidationErrors(value?: unknown): string[] {
  if (value !== undefined) {
    validateIRSchema(value);
  }
  if (!validateIRSchema.errors) {
    return [];
  }
  return validateIRSchema.errors.map((error) => `${error.instancePath || "/"} ${error.message}`);
}
