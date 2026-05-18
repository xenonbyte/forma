import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { FormaError } from "./errors.js";
import type { ProductService } from "./product.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

const sessionSchema = z.object({
  current_product: z.string().nullable()
});

export type FormaSession = z.infer<typeof sessionSchema>;

export interface SessionServiceOptions {
  home: string;
  products: ProductService;
}

export class SessionService {
  private readonly sessionFile: string;
  private readonly products: ProductService;

  constructor(options: SessionServiceOptions) {
    this.sessionFile = join(options.home, "session.yaml");
    this.products = options.products;
  }

  async getCurrentSession(): Promise<FormaSession> {
    if (!(await fileExists(this.sessionFile))) {
      return { current_product: null };
    }

    return readYamlAs(this.sessionFile, sessionSchema);
  }

  async setCurrentProduct(productId: string): Promise<FormaSession> {
    const product = await this.products.getProduct(productId);
    const missing = [
      product.platform ? null : "platform",
      product.style ? null : "style",
      product.components_initialized ? null : "components_initialized"
    ].filter((field): field is string => field !== null);

    if (missing.length > 0) {
      throw new FormaError("PRODUCT_CONFIG_INCOMPLETE", "Product config incomplete", {
        product_id: productId,
        missing
      });
    }

    const session = sessionSchema.parse({ current_product: productId });
    await writeYamlAtomic(this.sessionFile, session);
    return session;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
