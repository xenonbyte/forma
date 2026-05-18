import { BaselineService } from "./baseline.js";
import { DesignService } from "./design.js";
import { ProductService } from "./product.js";
import { RequirementService } from "./requirement.js";
import { SessionService } from "./session.js";
import { StyleService } from "./styles.js";
import { defaultPencilRunner, PencilService } from "./pencil.js";
import { SyncService } from "./sync.js";

export interface FormaStoreOptions {
  home: string;
  bundledStylesDir?: string;
}

export function createFormaStore(options: FormaStoreOptions) {
  const pencil = new PencilService({ home: options.home, runner: defaultPencilRunner });
  const styles = new StyleService({ home: options.home, bundledStylesDir: options.bundledStylesDir });
  const products = new ProductService({ home: options.home });
  const sessions = new SessionService({ home: options.home, products });
  const baseline = new BaselineService({ home: options.home, products });
  const requirements = new RequirementService({ home: options.home, products, baseline });
  const designs = new DesignService({ home: options.home, products });
  const sync = new SyncService({ home: options.home, pencilService: pencil, runner: defaultPencilRunner });

  return {
    home: options.home,
    baseline,
    designs,
    products,
    requirements,
    sessions,
    sync,
    styles
  };
}
