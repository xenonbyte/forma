import { ProductService } from "./product.js";
import { SessionService } from "./session.js";
import { StyleService } from "./styles.js";

export interface FormaStoreOptions {
  home: string;
  bundledStylesDir?: string;
}

export function createFormaStore(options: FormaStoreOptions) {
  const styles = new StyleService({ home: options.home, bundledStylesDir: options.bundledStylesDir });
  const products = new ProductService({ home: options.home });
  const sessions = new SessionService({ home: options.home, products });

  return {
    home: options.home,
    products,
    sessions,
    styles
  };
}
