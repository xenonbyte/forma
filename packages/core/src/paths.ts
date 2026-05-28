import { join } from "node:path";

export interface FormaPaths {
  rootDir: string;
  configFile: string;
  dataDir: string;
  sessionFile: string;
  productsDir: string;
  stylesDir: string;
}

export function getFormaPaths(rootDir = join(process.cwd(), ".forma")): FormaPaths {
  const dataDir = join(rootDir, "data");
  return {
    rootDir,
    configFile: join(rootDir, "config.yaml"),
    dataDir,
    sessionFile: join(rootDir, "session.yaml"),
    productsDir: join(dataDir, "products"),
    stylesDir: join(rootDir, "styles")
  };
}
