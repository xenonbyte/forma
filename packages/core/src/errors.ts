export type FormaErrorCode =
  | "PRODUCT_CONFIG_INCOMPLETE"
  | "REQUIREMENT_STATUS_INVALID"
  | "DOCUMENT_EMPTY"
  | "PAGES_EMPTY"
  | "PAGE_NOT_OWNED"
  | "PEN_FILE_INVALID"
  | "PAGE_NOT_DONE"
  | "NODE_NOT_FOUND"
  | "EXPORT_FORMAT_UNSUPPORTED"
  | "VERSION_TOO_LOW"
  | "HISTORY_FILE_MISSING"
  | "PRODUCT_NOT_FOUND"
  | "REQUIREMENT_NOT_FOUND"
  | "DESIGN_NOT_FOUND"
  | "STYLE_NOT_FOUND"
  | "PENCIL_CLI_NOT_FOUND"
  | "PENCIL_NOT_AUTHENTICATED"
  | "PENCIL_LOCK_HELD";

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
