import { join } from "node:path";

export interface FormaPaths {
  rootDir: string;
  configFile: string;
  lockFile: string;
  dataDir: string;
  sessionFile: string;
  manifestsDir: string;
  productsDir: string;
  requirementsDir: string;
  designsDir: string;
  skillsDir: string;
  commandsDir: string;
  libraryDir: string;
  stylesDir: string;
}

export function getFormaPaths(rootDir = join(process.cwd(), ".forma")): FormaPaths {
  const dataDir = join(rootDir, "data");
  return {
    rootDir,
    configFile: join(rootDir, "config.yaml"),
    lockFile: join(rootDir, "forma.lock"),
    dataDir,
    sessionFile: join(rootDir, "session.yaml"),
    manifestsDir: join(rootDir, "manifests"),
    productsDir: join(dataDir, "products"),
    requirementsDir: join(dataDir, "requirements"),
    designsDir: join(dataDir, "designs"),
    skillsDir: join(rootDir, "skills"),
    commandsDir: join(rootDir, "commands"),
    libraryDir: join(rootDir, "library"),
    stylesDir: join(rootDir, "styles")
  };
}
