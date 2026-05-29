export type FormaErrorCode =
  | "INVALID_INPUT"
  | "PRODUCT_CONFIG_INCOMPLETE"
  | "PRODUCT_MUTATION_LOCKED"
  | "PRODUCT_DELETION_RECOVERY_FAILED"
  | "LOCK_CORRUPT"
  | "STRICT_SCHEMA_VALIDATION_FAILED"
  | "REQUIREMENT_STATUS_INVALID"
  | "PRODUCT_NOT_FOUND"
  | "REQUIREMENT_NOT_FOUND"
  | "ARTIFACT_WRITE_FAIL"
  | "ARTIFACT_ALREADY_EXISTS"
  | "ARTIFACT_NOT_FOUND"
  | "OD_RUNTIME_FAILED"
  | "OD_RUNTIME_TIMEOUT"
  | "FORMA_LOCK_TIMEOUT"
  | "FORMA_DESKTOP_CONFIG_UNSUPPORTED"
  | "ARTIFACT_INVALID_INPUT"
  | "ARTIFACT_UNSUPPORTED_FORMAT"
  | "ARTIFACT_MANIFEST_INVALID"
  | "STYLE_NOT_FOUND"
  | "REQUIREMENT_PAGE_NOT_FOUND"
  | "REQUIREMENT_PRODUCT_MISMATCH"
  | "PREVIEW_RENDER_FAILED";

export class FormaError extends Error {
  constructor(
    public readonly code: FormaErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "FormaError";
  }

  toJSON() {
    return { error_code: this.code, message: this.message, details: this.details };
  }
}
