export type Locale = "en" | "zh";

export const localeStorageKey = "forma.locale";

export const messages: Record<Locale, Record<string, string>> = {
  en: {
    "app.adminWorkbench": "Admin workbench",
    "app.clientShell": "Client shell",
    "app.idle": "Idle",
    "action.annotations": "Annotations",
    "action.archive": "Archive",
    "action.archiving": "Archiving",
    "action.backToProduct": "Back to product",
    "action.baseline": "Baseline",
    "action.createProduct": "Create product",
    "action.createRequirement": "Create requirement",
    "action.creating": "Creating",
    "action.newProduct": "New product",
    "action.open": "Open",
    "action.openDesign": "Open design",
    "action.preview": "Preview",
    "action.product": "Product",
    "action.products": "Products",
    "action.saveConfiguration": "Save configuration",
    "action.saving": "Saving",
    "baseline.actions": "Actions",
    "baseline.copy": "Copy",
    "baseline.copyUnavailable": "Copy unavailable",
    "baseline.current": "Current",
    "baseline.defaultCopy": "Default copy",
    "baseline.empty": "Empty",
    "baseline.emptyBaseline": "Empty baseline",
    "baseline.emptyCopyEntries": "No copy entries are present.",
    "baseline.emptyGenerated": "No functional pages or navigation have been generated for this product.",
    "baseline.emptyNavigation": "No navigation edges are present.",
    "baseline.features": "Features",
    "baseline.fields": "Fields",
    "baseline.functionalPages": "Functional pages",
    "baseline.graph": "Graph",
    "baseline.interactions": "Interactions",
    "baseline.list": "List",
    "baseline.loading": "Loading functional pages and navigation.",
    "baseline.loadingCopy": "Loading copy",
    "baseline.navigationGraph": "Navigation graph",
    "baseline.noLabel": "No label",
    "baseline.none": "None",
    "baseline.outdated": "Outdated",
    "baseline.sources": "Sources",
    "baseline.status": "Status",
    "baseline.tableContext": "Context",
    "baseline.unavailable": "Baseline unavailable",
    "baseline.view": "Baseline view",
    "common.notConfigured": "Not configured",
    "common.to": "to",
    "nav.products": "Products",
    "nav.products.meta": "Sessions and requirements",
    "nav.styles": "Styles",
    "nav.styles.meta": "Design libraries",
    "platform.desktop": "Desktop",
    "platform.mobile": "Mobile",
    "platform.tablet": "Tablet",
    "platform.web": "Web",
    "product.archiveGate": "Archive gate",
    "product.archiveGateHelp": "Archive is available only for active requirements.",
    "product.baselineEdges": "navigation edges",
    "product.baselineEdgeSingular": "navigation edge",
    "product.configStatus": "Config status",
    "product.completeConfiguration": "Complete configuration",
    "product.configuration": "Product configuration",
    "product.configRequestFailed": "Config request failed",
    "product.defaultLanguage": "Default language",
    "product.description": "Description",
    "product.details": "Product details",
    "product.id": "Product ID",
    "product.index": "Product index",
    "product.indexLoading": "Loading products, configuration state, and latest requirement status.",
    "product.indexUnavailable": "Product index unavailable",
    "product.languageSummaryEmpty": "Not configured",
    "product.languages": "Languages",
    "product.latestStatus": "Latest status",
    "product.loaded": "products loaded. Requirement summaries are isolated per product.",
    "product.name": "Name",
    "product.descriptionPlaceholder": "Operational scope and product surface.",
    "product.noDescription": "No description",
    "product.noProducts": "No products",
    "product.noProductsHelp": "Product records will appear here after creation.",
    "product.platform": "Platform",
    "product.readyToCreate": "Ready to create",
    "product.readyToCreateHelp": "Product details and configuration will be sent to the product API.",
    "product.requiredFields": "Required fields",
    "product.requiredFieldsHelp": "Name, description, platform, style, and language configuration are required before creation.",
    "product.retryConfiguration": "Product {productId} was created. Retry will apply configuration to the existing product.",
    "product.selectPlatform": "Select platform",
    "product.selectStyle": "Select style",
    "product.style": "Style",
    "product.stylesLoading": "Loading styles",
    "product.stylesUnavailable": "Styles unavailable",
    "product.submission": "Submission",
    "product.submissionCreateHelp": "Creating product record and applying configuration.",
    "product.submissionRejected": "Submission rejected",
    "product.unavailable": "Product unavailable",
    "product.workspace": "Product workspace",
    "product.workspaceLoading": "Loading product record and requirement history.",
    "requirement.actionResult": "Action result",
    "requirement.baseline": "Baseline",
    "requirement.createNeedsTitle": "Submit requires a title.",
    "requirement.designHistory": "Design history",
    "requirement.document": "Requirement document",
    "requirement.documentEmpty": "No markdown document is stored for this requirement.",
    "requirement.list": "Requirement list",
    "requirement.listUnavailable": "Requirement list unavailable",
    "requirement.loadedForProduct": "Records loaded for this product.",
    "requirement.loading": "Loading requirement document and page records.",
    "requirement.navigation": "Navigation",
    "requirement.navigationEmpty": "No navigation edges are attached.",
    "requirement.new": "New requirement",
    "requirement.noDesign": "No design",
    "requirement.noDesignAction": "No design action",
    "requirement.noDesignIds": "No design IDs are present.",
    "requirement.noRequirements": "No requirements",
    "requirement.noRequirementsHelp": "Submitted and active requirement records will appear here.",
    "requirement.noUiChanges": "No UI changes",
    "requirement.pageCount": "pages",
    "requirement.pageCountSingular": "page",
    "requirement.pages": "Requirement pages",
    "requirement.pagesEmpty": "No page records are attached to this requirement.",
    "requirement.records": "Requirements",
    "requirement.recordCount": "requirements",
    "requirement.recordCountSingular": "requirement",
    "requirement.requestFailed": "Requirement status request failed",
    "requirement.title": "Title",
    "requirement.titlePlaceholder": "Checkout update",
    "requirement.titleReady": "Title is ready.",
    "requirement.unavailable": "Requirement unavailable",
    "state.empty": "empty",
    "state.error": "error",
    "state.loading": "loading",
    "status.active": "Active",
    "status.archived": "Archived",
    "status.configuration_incomplete": "Configuration incomplete",
    "status.configured": "Configured",
    "status.done": "Done",
    "status.empty": "Empty",
    "status.expired": "Expired",
    "status.initialized": "Initialized",
    "status.not_initialized": "Not initialized",
    "status.not_loaded": "Not loaded",
    "status.pending": "Pending",
    "status.submitted": "Submitted",
    "status.unconfigured": "Unconfigured"
  },
  zh: {
    "app.adminWorkbench": "管理工作台",
    "app.clientShell": "客户端外壳",
    "app.idle": "空闲",
    "action.annotations": "标注",
    "action.archive": "归档",
    "action.archiving": "归档中",
    "action.backToProduct": "返回产品",
    "action.baseline": "基线",
    "action.createProduct": "创建产品",
    "action.createRequirement": "创建需求",
    "action.creating": "创建中",
    "action.newProduct": "新建产品",
    "action.open": "打开",
    "action.openDesign": "打开设计",
    "action.preview": "预览",
    "action.product": "产品",
    "action.products": "产品",
    "action.saveConfiguration": "保存配置",
    "action.saving": "保存中",
    "baseline.actions": "操作",
    "baseline.copy": "文案",
    "baseline.copyUnavailable": "文案不可用",
    "baseline.current": "当前",
    "baseline.defaultCopy": "默认文案",
    "baseline.empty": "空",
    "baseline.emptyBaseline": "空基线",
    "baseline.emptyCopyEntries": "没有文案条目。",
    "baseline.emptyGenerated": "该产品尚未生成功能页面或导航。",
    "baseline.emptyNavigation": "没有导航边。",
    "baseline.features": "功能",
    "baseline.fields": "字段",
    "baseline.functionalPages": "功能页面",
    "baseline.graph": "图谱",
    "baseline.interactions": "交互",
    "baseline.list": "列表",
    "baseline.loading": "正在加载功能页面和导航。",
    "baseline.loadingCopy": "正在加载文案",
    "baseline.navigationGraph": "导航图谱",
    "baseline.noLabel": "无标签",
    "baseline.none": "无",
    "baseline.outdated": "已过期",
    "baseline.sources": "来源",
    "baseline.status": "状态",
    "baseline.tableContext": "上下文",
    "baseline.unavailable": "基线不可用",
    "baseline.view": "基线视图",
    "common.notConfigured": "未配置",
    "common.to": "至",
    "nav.products": "产品",
    "nav.products.meta": "会话与需求",
    "nav.styles": "样式",
    "nav.styles.meta": "设计库",
    "platform.desktop": "桌面",
    "platform.mobile": "移动端",
    "platform.tablet": "平板",
    "platform.web": "Web",
    "product.archiveGate": "归档门槛",
    "product.archiveGateHelp": "只有 active 状态的需求可以归档。",
    "product.baselineEdges": "条导航边",
    "product.baselineEdgeSingular": "条导航边",
    "product.configStatus": "配置状态",
    "product.completeConfiguration": "完成配置",
    "product.configuration": "产品配置",
    "product.configRequestFailed": "配置请求失败",
    "product.defaultLanguage": "默认语言",
    "product.description": "描述",
    "product.details": "产品详情",
    "product.id": "产品 ID",
    "product.index": "产品索引",
    "product.indexLoading": "正在加载产品、配置状态和最新需求状态。",
    "product.indexUnavailable": "产品索引不可用",
    "product.languageSummaryEmpty": "未配置",
    "product.languages": "语言",
    "product.latestStatus": "最新状态",
    "product.loaded": "个产品已加载。需求摘要按产品隔离。",
    "product.name": "名称",
    "product.descriptionPlaceholder": "运营范围和产品界面。",
    "product.noDescription": "无描述",
    "product.noProducts": "没有产品",
    "product.noProductsHelp": "创建后产品记录会显示在这里。",
    "product.platform": "平台",
    "product.readyToCreate": "可以创建",
    "product.readyToCreateHelp": "产品详情和配置将发送到产品 API。",
    "product.requiredFields": "必填字段",
    "product.requiredFieldsHelp": "创建前需要填写名称、描述、平台、样式和语言配置。",
    "product.retryConfiguration": "产品 {productId} 已创建。重试会将配置应用到这个已有产品。",
    "product.selectPlatform": "选择平台",
    "product.selectStyle": "选择样式",
    "product.style": "样式",
    "product.stylesLoading": "正在加载样式",
    "product.stylesUnavailable": "样式不可用",
    "product.submission": "提交",
    "product.submissionCreateHelp": "正在创建产品记录并应用配置。",
    "product.submissionRejected": "提交被拒绝",
    "product.unavailable": "产品不可用",
    "product.workspace": "产品工作区",
    "product.workspaceLoading": "正在加载产品记录和需求历史。",
    "requirement.actionResult": "操作结果",
    "requirement.baseline": "基线",
    "requirement.createNeedsTitle": "提交需要标题。",
    "requirement.designHistory": "设计历史",
    "requirement.document": "需求文档",
    "requirement.documentEmpty": "该需求没有存储 Markdown 文档。",
    "requirement.list": "需求列表",
    "requirement.listUnavailable": "需求列表不可用",
    "requirement.loadedForProduct": "该产品的记录已加载。",
    "requirement.loading": "正在加载需求文档和页面记录。",
    "requirement.navigation": "导航",
    "requirement.navigationEmpty": "没有关联的导航边。",
    "requirement.new": "新建需求",
    "requirement.noDesign": "无设计",
    "requirement.noDesignAction": "无需设计操作",
    "requirement.noDesignIds": "没有设计 ID。",
    "requirement.noRequirements": "没有需求",
    "requirement.noRequirementsHelp": "已提交和 active 的需求记录会显示在这里。",
    "requirement.noUiChanges": "无 UI 变更",
    "requirement.pageCount": "页",
    "requirement.pageCountSingular": "页",
    "requirement.pages": "需求页面",
    "requirement.pagesEmpty": "该需求没有关联的页面记录。",
    "requirement.records": "需求",
    "requirement.recordCount": "条需求",
    "requirement.recordCountSingular": "条需求",
    "requirement.requestFailed": "需求状态请求失败",
    "requirement.title": "标题",
    "requirement.titlePlaceholder": "结账更新",
    "requirement.titleReady": "标题已就绪。",
    "requirement.unavailable": "需求不可用",
    "state.empty": "空",
    "state.error": "错误",
    "state.loading": "加载中",
    "status.active": "活跃",
    "status.archived": "已归档",
    "status.configuration_incomplete": "配置不完整",
    "status.configured": "已配置",
    "status.done": "完成",
    "status.empty": "空",
    "status.expired": "已过期",
    "status.initialized": "已初始化",
    "status.not_initialized": "未初始化",
    "status.not_loaded": "未加载",
    "status.pending": "待处理",
    "status.submitted": "已提交",
    "status.unconfigured": "未配置"
  }
};

export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface InitialLocaleOptions {
  localStorage?: LocalStorageLike;
  navigatorLanguage?: string;
}

let currentLocale: Locale = getInitialLocale();

export function t(key: string): string {
  return translate(key, currentLocale);
}

export function translate(key: string, locale: Locale): string {
  return messages[locale][key] ?? messages.en[key] ?? key;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(next: Locale, localStorageLike: LocalStorageLike | undefined = getDefaultLocalStorage()): void {
  currentLocale = next;
  safeSetItem(localStorageLike, localeStorageKey, next);
}

export function getInitialLocale(options: InitialLocaleOptions = {}): Locale {
  const localStorageLike = options.localStorage ?? getDefaultLocalStorage();
  const stored = safeGetItem(localStorageLike, localeStorageKey);
  if (isLocale(stored)) {
    return stored;
  }

  const navigatorLanguage = options.navigatorLanguage ?? getDefaultNavigatorLanguage();
  return navigatorLanguage.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "zh";
}

function safeGetItem(localStorageLike: LocalStorageLike | undefined, key: string): string | null {
  try {
    return localStorageLike?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSetItem(localStorageLike: LocalStorageLike | undefined, key: string, value: string): void {
  try {
    localStorageLike?.setItem(key, value);
  } catch {
    // Storage can be unavailable in private mode, embedded contexts, or locked-down tests.
  }
}

function getDefaultLocalStorage(): LocalStorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function getDefaultNavigatorLanguage(): string {
  try {
    return typeof navigator === "undefined" ? "" : navigator.language;
  } catch {
    return "";
  }
}
