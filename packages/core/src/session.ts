import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertProductConfig, type ProductService } from "./product.js";
import {
  defaultProductMutationWarningSink,
  getProductMutationLock,
  runProductMutationWithWarnings,
  type ProductMutationContext,
  type ProductMutationLock
} from "./product-mutation-lock.js";
import { readYamlAs, writeYamlAtomic } from "./yaml.js";

const sessionSchema = z.object({
  current_product: z.string().nullable()
});

export type FormaSession = z.infer<typeof sessionSchema>;

export interface SessionServiceOptions {
  home: string;
  products: ProductService;
  productMutationLock?: ProductMutationLock;
  onProductMutationWarning?: (warning: string) => void;
}

export class SessionService {
  private readonly sessionFile: string;
  private readonly products: ProductService;
  private readonly productMutationLock: ProductMutationLock;
  private readonly onProductMutationWarning: (warning: string) => void;

  constructor(options: SessionServiceOptions) {
    this.sessionFile = join(options.home, "session.yaml");
    this.products = options.products;
    this.productMutationLock = options.productMutationLock ?? getProductMutationLock(options.home);
    this.onProductMutationWarning = options.onProductMutationWarning ?? defaultProductMutationWarningSink;
  }

  async getCurrentSession(): Promise<FormaSession> {
    if (!(await fileExists(this.sessionFile))) {
      return { current_product: null };
    }

    return readYamlAs(this.sessionFile, sessionSchema);
  }

  async setCurrentProduct(productId: string): Promise<FormaSession> {
    return this.runProductMutation({ operation: "set_current_product", product_id: productId }, async () =>
      this.setCurrentProductLocked(productId)
    );
  }

  async setCurrentProductLocked(productId: string): Promise<FormaSession> {
    const product = await this.products.getProduct(productId);
    assertProductConfig(product, productId, ["platform", "brand_style", "languages"]);

    const session = sessionSchema.parse({ current_product: productId });
    await writeYamlAtomic(this.sessionFile, session);
    return session;
  }

  private async runProductMutation<T>(
    input: { operation: string; product_id?: string },
    fn: (context: ProductMutationContext) => Promise<T>
  ): Promise<T> {
    return runProductMutationWithWarnings(
      this.productMutationLock,
      input,
      fn,
      this.onProductMutationWarning
    );
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
