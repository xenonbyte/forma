import type { CSSProperties, ReactNode } from "react";

import type { StyleMetadata, SystemStyleMetadata } from "../api.js";
import { useT } from "../LocaleContext.js";
import { parseDesignMd } from "../utils/parseDesignMd.js";

type TemplatePlatform = "desktop" | "mobile" | "tablet" | "web";

type ProductStyleTokens = {
  colors: {
    background: string;
    border: string;
    danger: string;
    primary: string;
    primaryHover: string;
    success: string;
    surface: string;
    surfaceMuted: string;
    textPrimary: string;
    textSecondary: string;
  };
  radius: {
    lg: string;
    md: string;
    sm: string;
  };
  shadow: {
    card: string;
    panel: string;
  };
  spacing: {
    lg: string;
    md: string;
    sm: string;
    xl: string;
    xs: string;
  };
  typography: {
    bodySize: string;
    captionSize: string;
    fontBody: string;
    fontHeading: string;
    fontWeightMedium: number;
    fontWeightNormal: number;
    fontWeightSemibold: number;
    titleSize: string;
  };
};

type ProductStyleComponents = {
  buttonPrimary: {
    background: string;
    borderRadius: string;
    height: string;
    paddingX: string;
    textColor: string;
  };
  card: {
    background: string;
    borderColor: string;
    borderRadius: string;
    shadow: string;
  };
  input: {
    background: string;
    borderColor: string;
    borderRadius: string;
    height: string;
    textColor: string;
  };
  nav: {
    activeBackground: string;
    activeTextColor: string;
    background: string;
    textColor: string;
  };
};

type ProductStyleTemplate = {
  components: ProductStyleComponents;
  description: string;
  displayName: string;
  name: string;
  tokens: ProductStyleTokens;
};

type DesignSpecTemplate = {
  description: string;
  displayName: string;
  name: string;
  rules: {
    desktop: {
      rules: {
        allowDenseData: boolean;
        commandBarHeight: string;
        leftRailWidth: string;
        preferredColumns: number;
        primaryActionPlacement: string;
      };
      structure: string[];
      template: string;
    };
    global: {
      contrast: string;
      density: string;
      focusRing: string;
      keyboardAccessible: boolean;
      layoutPrinciple: string;
      minTouchTarget: string;
    };
    mobile: {
      rules: {
        avoidDenseTables: boolean;
        bottomAction: boolean;
        cardPadding: string;
        navigation: string;
        singleColumn: boolean;
      };
      structure: string[];
      template: string;
    };
    tablet: {
      rules: {
        detailPanelVisible: boolean;
        preferredColumns: number;
        splitRatio: string;
        toolbarHeight: string;
      };
      structure: string[];
      template: string;
    };
    web: {
      rules: {
        buttonPlacement: string;
        contentMaxWidth: string;
        formLayout: string;
        preferredColumns: number;
        sidebarWidth: string;
      };
      structure: string[];
      template: string;
    };
  };
};

type PlatformTemplatePreviewProps =
  | {
      designMd?: string;
      kind: "style";
      metadata: StyleMetadata;
    }
  | {
      kind: "spec";
      metadata: SystemStyleMetadata;
    };

const platforms: TemplatePlatform[] = ["web", "mobile", "tablet", "desktop"];

const brand = {
  bg: "#F7F8FA",
  border: "#E4E4E7",
  danger: "#EF4444",
  primary: "#F59E0B",
  primarySoft: "#FEF3C7",
  success: "#22C55E",
  surface: "#FFFFFF",
  textPrimary: "#18181B",
  textSecondary: "#71717A"
};

export function PlatformTemplatePreview(props: PlatformTemplatePreviewProps) {
  if (props.kind === "style") {
    return <ProductStylePreview designMd={props.designMd} metadata={props.metadata} />;
  }

  return <DesignSpecPreview metadata={props.metadata} />;
}

function ProductStylePreview({ designMd, metadata }: { designMd?: string; metadata: StyleMetadata }) {
  const styleItem = productStyleFromMetadata(metadata, designMd);

  return (
    <section
      className="h-full min-w-0 overflow-auto rounded-xl border bg-white p-6 shadow-[0_1px_3px_rgba(24,24,27,0.10)]"
      data-preview-template-name={styleItem.name}
      data-primary={styleItem.tokens.colors.primary}
      data-style-preview-grid="true"
    >
      <TokenBar styleItem={styleItem} />
      <CommonStyleBlocks styleItem={styleItem} />

      <div className="grid grid-cols-2 gap-4">
        {platforms.map((platform) => (
          <ProductStylePreviewCard key={platform} styleItem={styleItem} title={platformLabel(platform)}>
            {productStyleMock(platform, styleItem)}
          </ProductStylePreviewCard>
        ))}
      </div>
    </section>
  );
}

function DesignSpecPreview({ metadata }: { metadata: SystemStyleMetadata }) {
  const t = useT();
  const spec = designSpecFromMetadata(metadata);

  return (
    <section
      className="h-full min-w-0 overflow-auto rounded-xl border bg-white p-6 shadow-[0_1px_3px_rgba(24,24,27,0.10)]"
      data-preview-template-name={spec.name}
      data-system-preview-grid="true"
    >
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[18px] font-semibold text-zinc-900">
            {spec.displayName} {t("systemStylePicker.specPreview")}
          </h3>
          <IllustrativeBadge label={t("templatePreview.illustrative")} />
        </div>
        <p className="mt-1 text-sm text-zinc-500">{spec.description}</p>
      </div>

      <RulesSummary spec={spec} />

      <div className="grid grid-cols-2 gap-4">
        {platforms.map((platform) => (
          <SpecPreviewCard key={platform} title={platformLabel(platform)}>
            {designSpecMock(platform, spec)}
          </SpecPreviewCard>
        ))}
      </div>
    </section>
  );
}

function ProductStylePreviewCard({ children, styleItem, title }: { children: ReactNode; styleItem: ProductStyleTemplate; title: string }) {
  const colors = styleItem.tokens.colors;

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        background: colors.surface,
        borderColor: colors.border,
        boxShadow: styleItem.tokens.shadow.card
      }}
    >
      <div className="border-b px-4 py-3 text-sm font-semibold" style={{ borderColor: colors.border, color: colors.textPrimary }}>
        {title}
      </div>
      <div className="p-3" style={{ background: colors.background }}>
        {children}
      </div>
    </div>
  );
}

function SpecPreviewCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: brand.border }}>
      <div className="border-b px-4 py-3 text-sm font-semibold" style={{ borderColor: brand.border, color: brand.textPrimary }}>
        {title}
      </div>
      <div className="p-3" style={{ background: brand.bg }}>
        {children}
      </div>
    </div>
  );
}

function TokenBar({ styleItem }: { styleItem: ProductStyleTemplate }) {
  const t = useT();
  const colors = styleItem.tokens.colors;
  const colorItems = [
    { label: "Primary", value: colors.primary },
    { label: "Success", value: colors.success },
    { label: "Danger", value: colors.danger },
    { label: "BG", value: colors.background },
    { label: "Surface", value: colors.surface },
    { label: "Muted", value: colors.surfaceMuted },
    { label: "Border", value: colors.border },
    { label: "Text 2", value: colors.textSecondary },
    { label: "Text 1", value: colors.textPrimary }
  ];

  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-[16rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[18px] font-semibold text-zinc-900">
            {styleItem.displayName} {t("stylePicker.stylePreview")}
          </h3>
          <IllustrativeBadge label={t("templatePreview.illustrative")} />
        </div>
        <p className="mt-1 text-sm text-zinc-500">{styleItem.description}</p>
      </div>

      <div className="flex max-w-[34rem] flex-wrap gap-3">
        {colorItems.map((item) => (
          <div className="flex items-center gap-2" key={item.label}>
            <span className="block h-5 w-5 rounded-md border" style={{ background: item.value, borderColor: "#D4D4D8" }} />
            <div className="text-xs text-zinc-500">
              <div className="font-medium text-zinc-700">{item.label}</div>
              <div>{item.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommonStyleBlocks({ styleItem }: { styleItem: ProductStyleTemplate }) {
  const t = useT();
  const colors = styleItem.tokens.colors;
  const typography = styleItem.tokens.typography;
  const radius = styleItem.tokens.radius;
  const spacing = styleItem.tokens.spacing;

  return (
    <div className="mb-4 grid grid-cols-4 gap-3">
      <div className="rounded-lg border p-3" style={{ background: colors.surface, borderColor: colors.border }}>
        <div className="text-xs text-zinc-500">{t("templatePreview.font")}</div>
        <div
          className="mt-2 font-semibold"
          style={{
            color: colors.textPrimary,
            fontFamily: typography.fontHeading,
            fontSize: typography.titleSize
          }}
        >
          Inter Heading
        </div>
        <div className="mt-1" style={{ color: colors.textSecondary, fontFamily: typography.fontBody, fontSize: typography.bodySize }}>
          Body 14px / Caption 12px
        </div>
      </div>

      <div className="rounded-lg border p-3" style={{ background: colors.surface, borderColor: colors.border }}>
        <div className="text-xs text-zinc-500">{t("templatePreview.radius")}</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-7 w-7 border" style={{ background: colors.surfaceMuted, borderRadius: radius.sm }} />
          <div className="h-7 w-7 border" style={{ background: colors.surfaceMuted, borderRadius: radius.md }} />
          <div className="h-7 w-7 border" style={{ background: colors.surfaceMuted, borderRadius: radius.lg }} />
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          sm {radius.sm} / md {radius.md} / lg {radius.lg}
        </div>
      </div>

      <div className="rounded-lg border p-3" style={{ background: colors.surface, borderColor: colors.border }}>
        <div className="text-xs text-zinc-500">{t("templatePreview.spacing")}</div>
        <div className="mt-2 flex items-end gap-2">
          {[spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl].map((value) => (
            <div className="w-4" key={value} style={{ background: colors.primary, height: px(value) }} />
          ))}
        </div>
        <div className="mt-2 text-xs text-zinc-500">xs / sm / md / lg / xl</div>
      </div>

      <div className="rounded-lg border p-3" style={{ background: colors.surface, borderColor: colors.border }}>
        <div className="text-xs text-zinc-500">{t("templatePreview.components")}</div>
        <div className="mt-2 flex items-center gap-2">
          <button className="px-3 text-sm font-medium" style={buttonStyle(styleItem)} type="button">
            主按钮
          </button>
          <span className="rounded-full px-2 py-1 text-xs" style={{ background: "#DCFCE7", color: "#166534" }}>
            正常
          </span>
        </div>
      </div>
    </div>
  );
}

function RulesSummary({ spec }: { spec: DesignSpecTemplate }) {
  const t = useT();
  const global = spec.rules.global;

  return (
    <div className="mb-5 grid grid-cols-3 gap-3">
      <div className="rounded-xl border bg-white p-4" style={{ borderColor: brand.border }}>
        <div className="text-xs text-zinc-500">{t("templatePreview.density")}</div>
        <div className="mt-2 text-base font-semibold text-zinc-900">{global.density}</div>
        <div className="mt-1 text-sm text-zinc-500">{global.layoutPrinciple}</div>
      </div>
      <div className="rounded-xl border bg-white p-4" style={{ borderColor: brand.border }}>
        <div className="text-xs text-zinc-500">{t("templatePreview.accessibility")}</div>
        <div className="mt-2 text-base font-semibold text-zinc-900">
          {global.minTouchTarget} / {global.contrast}
        </div>
        <div className="mt-1 text-sm text-zinc-500">
          {global.keyboardAccessible ? t("templatePreview.keyboardSupported") : t("templatePreview.keyboardUnsupported")} · {global.focusRing}
        </div>
      </div>
      <div className="rounded-xl border bg-white p-4" style={{ borderColor: brand.border }}>
        <div className="text-xs text-zinc-500">{t("templatePreview.structure")}</div>
        <div className="mt-2 text-base font-semibold text-zinc-900">{t("templatePreview.crossPlatform")}</div>
        <div className="mt-1 text-sm text-zinc-500">{spec.description}</div>
      </div>
    </div>
  );
}

function IllustrativeBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
      {label}
    </span>
  );
}

function productStyleMock(platform: TemplatePlatform, styleItem: ProductStyleTemplate): ReactNode {
  if (platform === "mobile") return <ProductStyleMobilePreview styleItem={styleItem} />;
  if (platform === "tablet") return <ProductStyleTabletPreview styleItem={styleItem} />;
  if (platform === "desktop") return <ProductStyleDesktopPreview styleItem={styleItem} />;
  return <ProductStyleWebPreview styleItem={styleItem} />;
}

function designSpecMock(platform: TemplatePlatform, spec: DesignSpecTemplate): ReactNode {
  if (platform === "mobile") return <MobileSpecPreview spec={spec} />;
  if (platform === "tablet") return <TabletSpecPreview spec={spec} />;
  if (platform === "desktop") return <DesktopSpecPreview spec={spec} />;
  return <WebSpecPreview spec={spec} />;
}

function ProductStyleWebPreview({ styleItem }: { styleItem: ProductStyleTemplate }) {
  const colors = styleItem.tokens.colors;
  const text2 = colors.textSecondary;
  const primaryBg = resolveToken(styleItem.components.buttonPrimary.background, styleItem);
  const inputBorder = resolveToken(styleItem.components.input.borderColor, styleItem);
  const inputRadius = resolveToken(styleItem.components.input.borderRadius, styleItem);
  const navBg = resolveToken(styleItem.components.nav.activeBackground, styleItem);
  const activeText = resolveToken(styleItem.components.nav.activeTextColor, styleItem);

  return (
    <div className="rounded-lg border" data-preview-mock="web" style={{ background: colors.surface, borderColor: colors.border, color: colors.textPrimary }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: colors.border }}>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">{styleItem.displayName}</span>
          <span style={{ color: text2 }}>项目管理</span>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: text2 }}>
          {["概览", "项目", "任务", "报表"].map((item, index) => (
            <span className="rounded px-2 py-1" key={item} style={index === 0 ? { background: navBg, color: activeText } : undefined}>
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">客户列表</div>
            <div className="text-xs" style={{ color: text2 }}>
              表格化、轻量、适合运营和数据管理
            </div>
          </div>
          <button className="px-3 text-xs font-medium" style={{ ...buttonStyle(styleItem), background: primaryBg, height: 32 }} type="button">
            + 新建记录
          </button>
        </div>

        <MetricCards
          border={colors.border}
          surface={colors.surface}
          textPrimary={colors.textPrimary}
          textSecondary={text2}
          values={[
            ["客户总数", "256", "↑ 12.4%", colors.success],
            ["活跃项目", "142", "↑ 12.4%", colors.success],
            ["待跟进", "68", "↑ 12.4%", colors.success],
            ["异常项", "12", "↓ 3.1%", colors.danger]
          ]}
        />

        <div className="flex items-center gap-2">
          <input
            className="w-[260px] px-3 text-xs outline-none"
            readOnly
            style={{
              border: `1px solid ${inputBorder}`,
              borderRadius: inputRadius,
              color: text2,
              height: 32
            }}
            value="搜索客户名称、负责人、标签"
          />
          {["分组", "筛选"].map((item) => (
            <div
              className="flex h-8 items-center px-3 text-xs"
              key={item}
              style={{
                border: `1px solid ${inputBorder}`,
                borderRadius: inputRadius,
                color: text2
              }}
            >
              {item}
            </div>
          ))}
        </div>

        <DataTable
          border={colors.border}
          headerBackground={colors.surfaceMuted}
          headerColor={text2}
          rows={[
            ["极光科技", "互联网", "张三", "合作中", "¥120,000", "5 分钟前"],
            ["云途数据", "企业服务", "李四", "跟进中", "¥85,000", "1 天前"],
            ["星图传媒", "内容", "王五", "合作中", "¥56,000", "2 天前"]
          ]}
          statusIndex={3}
          templateColumns="2fr 1fr 1fr 1fr 1fr 1fr"
          textColor={colors.textPrimary}
        />
      </div>
    </div>
  );
}

function ProductStyleMobilePreview({ styleItem }: { styleItem: ProductStyleTemplate }) {
  const colors = styleItem.tokens.colors;

  return (
    <div className="flex justify-center" data-preview-mock="mobile">
      <div className="w-[220px] overflow-hidden rounded-[24px] border-[6px]" style={{ background: colors.surface, borderColor: "#111827" }}>
        <div className="px-4 pt-3 text-[10px] font-medium">9:41</div>
        <div className="px-4 pb-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
              项目管理
            </div>
            <div className="text-xs" style={{ color: colors.textSecondary }}>
              ☰
            </div>
          </div>
          <input
            className="mb-3 w-full px-3 text-[11px] outline-none"
            readOnly
            style={{
              border: `1px solid ${resolveToken(styleItem.components.input.borderColor, styleItem)}`,
              borderRadius: resolveToken(styleItem.components.input.borderRadius, styleItem),
              color: colors.textSecondary,
              height: 34
            }}
            value="搜索项目"
          />
          <div className="mb-3 flex gap-2 text-[11px]" style={{ color: colors.textSecondary }}>
            <span className="rounded-full px-2 py-1" style={{ background: colors.surfaceMuted, color: colors.textPrimary }}>
              全部
            </span>
            <span>进行中</span>
            <span>已完成</span>
          </div>
          <div className="space-y-2">
            {[
              ["官网改版", "进行中", "65%"],
              ["移动端重构", "已发布", "100%"],
              ["数据看板", "待跟进", "20%"]
            ].map((item) => (
              <div className="rounded-lg border p-3" key={item[0]} style={{ background: colors.surface, borderColor: colors.border }}>
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                    {item[0]}
                  </div>
                  <StatusPill status={item[1]!} />
                </div>
                <div className="mt-1 text-[10px]" style={{ color: colors.textSecondary }}>
                  完成度 {item[2]}
                </div>
              </div>
            ))}
          </div>
          <button className="mt-4 w-full text-sm font-medium" style={buttonStyle(styleItem)} type="button">
            + 新建
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductStyleTabletPreview({ styleItem }: { styleItem: ProductStyleTemplate }) {
  const colors = styleItem.tokens.colors;

  return (
    <div className="overflow-hidden rounded-lg border" data-preview-mock="tablet" style={{ background: colors.surface, borderColor: colors.border }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: colors.border }}>
        <div className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
          产品
        </div>
        <div className="text-xs" style={{ color: colors.textSecondary }}>
          搜索 · 筛选 · 新建
        </div>
      </div>
      <div className="grid grid-cols-[40%_60%]">
        <div className="border-r p-3" style={{ borderColor: colors.border }}>
          <div className="mb-2 text-[11px] font-medium" style={{ color: colors.textSecondary }}>
            列表面板
          </div>
          <div className="space-y-2">
            {["智能门锁 Pro", "无线摄像头 2K", "人体传感器", "智能插座"].map((item, index) => (
              <div className="rounded-lg border p-2" key={item} style={{ background: index === 0 ? colors.surfaceMuted : colors.surface, borderColor: colors.border }}>
                <div className="text-[12px] font-medium" style={{ color: colors.textPrimary }}>
                  {item}
                </div>
                <div className="mt-1 text-[10px]" style={{ color: colors.textSecondary }}>
                  SKU · 状态 · 库存
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
                智能门锁 Pro
              </div>
              <div className="text-[10px]" style={{ color: colors.textSecondary }}>
                右侧详情面板
              </div>
            </div>
            <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] text-green-700">在售</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {["负责人", "品牌", "创建时间", "可用库存"].map((item, index) => (
              <div className="rounded-lg border p-2" key={item} style={{ background: colors.surface, borderColor: colors.border }}>
                <div className="text-[10px]" style={{ color: colors.textSecondary }}>
                  {item}
                </div>
                <div className="mt-1 text-[11px] font-medium" style={{ color: colors.textPrimary }}>
                  {["张三", "Forma", "2024-05-01", "1,230"][index]}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border p-3" style={{ background: colors.surface, borderColor: colors.border }}>
            <div className="text-[11px] font-medium" style={{ color: colors.textPrimary }}>
              描述
            </div>
            <div className="mt-1 text-[10px]" style={{ color: colors.textSecondary }}>
              清爽、轻量、表格化的信息组织，适用于后台与数据管理工具。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductStyleDesktopPreview({ styleItem }: { styleItem: ProductStyleTemplate }) {
  const colors = styleItem.tokens.colors;

  return (
    <div className="overflow-hidden rounded-lg border" data-preview-mock="desktop" style={{ background: colors.surface, borderColor: colors.border }}>
      <div className="grid grid-cols-[72px_1fr]">
        <div className="border-r p-2" style={{ background: colors.surface, borderColor: colors.border }}>
          <div className="mb-2 text-center text-[10px] font-semibold" style={{ color: colors.textPrimary }}>
            工作台
          </div>
          {["概览", "产品", "客户", "数据", "设置"].map((item, index) => (
            <div
              className="mb-2 rounded-lg px-2 py-2 text-center text-[10px]"
              key={item}
              style={{
                background: index === 1 ? colors.surfaceMuted : "transparent",
                color: index === 1 ? colors.textPrimary : colors.textSecondary
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: colors.border }}>
            <div className="text-sm font-semibold" style={{ color: colors.textPrimary }}>
              客户列表
            </div>
            <button className="px-3 text-[11px] font-medium" style={{ ...buttonStyle(styleItem), height: 28 }} type="button">
              + 新建记录
            </button>
          </div>
          <div className="p-3">
            <MetricCards
              border={colors.border}
              surface={colors.surface}
              textPrimary={colors.textPrimary}
              textSecondary={colors.textSecondary}
              values={[
                ["客户总数", "256", "", colors.success],
                ["合作中", "142", "", colors.success],
                ["跟进中", "68", "", colors.success],
                ["异常", "12", "", colors.danger]
              ]}
            />
            <DataTable
              border={colors.border}
              headerBackground={colors.surfaceMuted}
              headerColor={colors.textSecondary}
              rows={[
                ["极光科技", "张三", "合作中", "¥120,000", "5 分钟前"],
                ["云途数据", "李四", "跟进中", "¥85,000", "1 天前"],
                ["星图传媒", "王五", "合作中", "¥56,000", "2 天前"]
              ]}
              statusIndex={2}
              templateColumns="2fr 1fr 1fr 1fr 1fr"
              textColor={colors.textPrimary}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function WebSpecPreview({ spec }: { spec: DesignSpecTemplate }) {
  const rules = spec.rules.web.rules;

  return (
    <div className="overflow-hidden rounded-lg border bg-white" data-preview-mock="web" data-spec-preview-mock="web" style={{ borderColor: brand.border }}>
      <div className="grid grid-cols-[220px_1fr]">
        <div className="border-r p-3" style={{ borderColor: brand.border }}>
          <div className="mb-3 text-sm font-semibold text-zinc-900">侧边导航</div>
          {["概览", "产品", "订单", "客户", "分析", "设置"].map((item, index) => (
            <div
              className="mb-2 rounded-lg px-3 py-2 text-sm"
              key={item}
              style={{
                background: index === 1 ? brand.primarySoft : "transparent",
                color: index === 1 ? brand.textPrimary : brand.textSecondary
              }}
            >
              {item}
            </div>
          ))}
          <div className="mt-3 text-[11px] text-zinc-500">sidebarWidth: {rules.sidebarWidth}</div>
        </div>
        <div>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: brand.border }}>
            <div>
              <div className="text-base font-semibold text-zinc-900">产品列表</div>
              <div className="text-xs text-zinc-500">
                表单布局：{rules.formLayout} · 列数：{rules.preferredColumns}
              </div>
            </div>
            <button className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-medium text-zinc-950" type="button">
              + 新建产品
            </button>
          </div>
          <div className="p-4">
            <div className="mb-3 grid grid-cols-3 gap-2">
              {["总产品", "在售", "库存不足"].map((item, index) => (
                <div className="rounded-lg border p-3" key={item} style={{ borderColor: brand.border }}>
                  <div className="text-[11px] text-zinc-500">{item}</div>
                  <div className="mt-2 text-lg font-semibold text-zinc-900">{[1248, 980, 68][index]}</div>
                </div>
              ))}
            </div>
            <SimpleProductRows />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileSpecPreview({ spec }: { spec: DesignSpecTemplate }) {
  const rules = spec.rules.mobile.rules;

  return (
    <div className="flex justify-center" data-preview-mock="mobile" data-spec-preview-mock="mobile">
      <div className="w-[220px] overflow-hidden rounded-[24px] border-[6px] border-zinc-900 bg-white">
        <div className="px-4 pt-3 text-[10px] font-medium">9:41</div>
        <div className="px-4 pb-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900">产品</div>
            <div className="text-xs text-zinc-500">•••</div>
          </div>
          <div className="space-y-2">
            {[
              ["总产品", "980"],
              ["库存不足", "68"]
            ].map((row) => (
              <div className="rounded-lg border bg-white p-3" key={row[0]} style={{ borderColor: brand.border, padding: rules.cardPadding }}>
                <div className="text-[10px] text-zinc-500">{row[0]}</div>
                <div className="mt-1 text-base font-semibold text-zinc-900">{row[1]}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {["智能门锁 Pro", "无线摄像头 2K", "人体传感器"].map((item) => (
              <div className="rounded-lg border bg-white p-3" key={item} style={{ borderColor: brand.border, padding: rules.cardPadding }}>
                <div className="text-[12px] font-medium text-zinc-900">{item}</div>
                <div className="mt-1 text-[10px] text-zinc-500">单列卡片布局 · 避免密集表格</div>
              </div>
            ))}
          </div>
          {rules.bottomAction ? (
            <button className="mt-4 w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-zinc-950" type="button">
              底部主操作
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabletSpecPreview({ spec }: { spec: DesignSpecTemplate }) {
  const rules = spec.rules.tablet.rules;

  return (
    <div className="overflow-hidden rounded-lg border bg-white" data-preview-mock="tablet" data-spec-preview-mock="tablet" style={{ borderColor: brand.border }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: brand.border }}>
        <div className="text-sm font-semibold text-zinc-900">平板分栏视图</div>
        <div className="text-[11px] text-zinc-500">
          {rules.splitRatio} · toolbar {rules.toolbarHeight}
        </div>
      </div>
      <div className="grid grid-cols-[40%_60%]">
        <div className="border-r p-3" style={{ borderColor: brand.border }}>
          <div className="mb-2 text-[11px] font-medium text-zinc-500">左侧列表面板</div>
          {["智能门锁 Pro", "无线摄像头 2K", "人体传感器"].map((item, index) => (
            <div className="mb-2 rounded-lg border p-3" key={item} style={{ background: index === 0 ? "#FFF7ED" : "#FFFFFF", borderColor: brand.border }}>
              <div className="text-[12px] font-medium text-zinc-900">{item}</div>
              <div className="mt-1 text-[10px] text-zinc-500">列表层级清晰</div>
            </div>
          ))}
        </div>
        <div className="p-3">
          <div className="mb-3 text-sm font-semibold text-zinc-900">右侧详情面板</div>
          <div className="grid grid-cols-2 gap-2">
            {["名称", "状态", "库存", "负责人"].map((item) => (
              <div className="rounded-lg border bg-white p-3" key={item} style={{ borderColor: brand.border }}>
                <div className="text-[10px] text-zinc-500">{item}</div>
                <div className="mt-1 text-[12px] font-medium text-zinc-900">示例内容</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border bg-white p-3" style={{ borderColor: brand.border }}>
            <div className="text-[11px] font-medium text-zinc-900">辅助信息卡片</div>
            <div className="mt-1 text-[10px] text-zinc-500">多用于详情补充、状态摘要、备注等二级信息。</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopSpecPreview({ spec }: { spec: DesignSpecTemplate }) {
  const rules = spec.rules.desktop.rules;

  return (
    <div className="overflow-hidden rounded-lg border bg-white" data-preview-mock="desktop" data-spec-preview-mock="desktop" style={{ borderColor: brand.border }}>
      <div className="grid grid-cols-[72px_1fr]">
        <div className="border-r p-2" style={{ borderColor: brand.border }}>
          <div className="mb-2 text-center text-[10px] font-semibold text-zinc-900">导航</div>
          {["概览", "产品", "客户", "分析", "设置"].map((item, index) => (
            <div
              className="mb-2 rounded-lg px-2 py-2 text-center text-[10px]"
              key={item}
              style={{
                background: index === 1 ? "#FEF3C7" : "transparent",
                color: index === 1 ? "#18181B" : "#71717A"
              }}
            >
              {item}
            </div>
          ))}
          <div className="mt-2 text-center text-[10px] text-zinc-400">{rules.leftRailWidth}</div>
        </div>
        <div>
          <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: brand.border }}>
            <div className="text-sm font-semibold text-zinc-900">Command Bar</div>
            <button className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-medium text-zinc-950" type="button">
              + 新建产品
            </button>
          </div>
          <div className="p-3">
            <div className="mb-3 grid grid-cols-4 gap-2">
              {["总产品", "在售", "库存不足", "今日订单"].map((item, index) => (
                <div className="rounded-lg border bg-white p-3" key={item} style={{ borderColor: brand.border }}>
                  <div className="text-[10px] text-zinc-500">{item}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">{[1248, 980, 68, 256][index]}</div>
                </div>
              ))}
            </div>
            <DataTable
              border={brand.border}
              headerBackground="#F4F4F5"
              headerColor="#71717A"
              rows={[
                ["智能门锁 Pro", "PLS-001", "智能家居", "1230", "在售", "查看"],
                ["无线摄像头 2K", "CAM-002", "安防", "856", "在售", "查看"],
                ["人体传感器", "SEN-003", "传感器", "324", "库存不足", "查看"]
              ]}
              statusIndex={4}
              templateColumns="2fr 1fr 1fr 1fr 1fr 1fr"
              textColor="#18181B"
            />
            <div className="mt-2 text-[10px] text-zinc-500">
              allowDenseData: {String(rules.allowDenseData)} · preferredColumns: {rules.preferredColumns}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCards({
  border,
  surface,
  textPrimary,
  textSecondary,
  values
}: {
  border: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  values: Array<[string, string, string, string]>;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {values.map(([label, value, change, changeColor]) => (
        <div className="rounded-lg border p-2" key={label} style={{ background: surface, borderColor: border }}>
          <div className="text-[10px]" style={{ color: textSecondary }}>
            {label}
          </div>
          <div className="mt-1 text-sm font-semibold" style={{ color: textPrimary }}>
            {value}
          </div>
          {change ? (
            <div className="mt-1 text-[10px]" style={{ color: changeColor }}>
              {change}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DataTable({
  border,
  headerBackground,
  headerColor,
  rows,
  statusIndex,
  templateColumns,
  textColor
}: {
  border: string;
  headerBackground: string;
  headerColor: string;
  rows: string[][];
  statusIndex: number;
  templateColumns: string;
  textColor: string;
}) {
  const headers = rows[0]?.length === 6 ? ["名称", "类型", "负责人", "状态", "金额", "更新"] : ["名称", "负责人", "状态", "金额", "更新"];

  return (
    <div className="mt-3 overflow-hidden rounded-lg border" style={{ borderColor: border }}>
      <div className="grid px-3 py-2 text-[10px]" style={{ background: headerBackground, color: headerColor, gridTemplateColumns: templateColumns }}>
        {headers.map((header) => (
          <div key={header}>{header}</div>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div className="grid border-t px-3 py-2 text-[10px]" key={`${row[0]}-${rowIndex}`} style={{ borderColor: border, color: textColor, gridTemplateColumns: templateColumns }}>
          {row.map((cell, cellIndex) => (
            <div key={`${cell}-${cellIndex}`}>
              {cellIndex === statusIndex ? <StatusPill status={cell} /> : cell}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SimpleProductRows() {
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {["产品名称", "状态", "操作"].map((item) => (
          <div className="rounded-md px-3 py-2 text-[11px] font-medium" key={item} style={{ background: "#F4F4F5", color: "#71717A" }}>
            {item}
          </div>
        ))}
      </div>
      {[
        ["智能门锁 Pro", "在售", "查看"],
        ["无线摄像头 2K", "在售", "查看"],
        ["人体传感器", "库存不足", "查看"]
      ].map((row) => (
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border p-2" key={row[0]} style={{ borderColor: brand.border }}>
          <div className="text-[11px] text-zinc-900">{row[0]}</div>
          <div>
            <StatusPill status={row[1]!} />
          </div>
          <div className="text-[11px] text-zinc-500">{row[2]}</div>
        </div>
      ))}
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const isWarning = ["跟进中", "待跟进"].includes(status);
  const isDanger = ["库存不足", "异常"].includes(status);

  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px]"
      style={{
        background: isDanger ? "#FEE2E2" : isWarning ? "#FEF3C7" : "#DCFCE7",
        color: isDanger ? "#991B1B" : isWarning ? "#92400E" : "#166534"
      }}
    >
      {status}
    </span>
  );
}

function buttonStyle(styleItem: ProductStyleTemplate): CSSProperties {
  return {
    background: resolveToken(styleItem.components.buttonPrimary.background, styleItem),
    borderRadius: resolveToken(styleItem.components.buttonPrimary.borderRadius, styleItem),
    color: resolveToken(styleItem.components.buttonPrimary.textColor, styleItem),
    height: resolveToken(styleItem.components.buttonPrimary.height, styleItem)
  };
}

function productStyleFromMetadata(metadata: StyleMetadata, designMd?: string): ProductStyleTemplate {
  const name = metadata.name;
  const preset = productStylePreset(name);
  const parsed = parseDesignMd(designMd ?? "");
  const colors = parsed.colors;
  const typography = parsed.typography;
  const rounded = parsed.rounded;
  const spacing = parsed.spacing;

  return {
    ...preset,
    description: metadata.description || preset.description,
    displayName: formatDisplayName(name),
    name,
    tokens: {
      ...preset.tokens,
      colors: {
        ...preset.tokens.colors,
        background: colors.background ?? colors.canvas ?? colors.bg ?? preset.tokens.colors.background,
        border: colors.border ?? preset.tokens.colors.border,
        danger: colors.danger ?? colors.error ?? preset.tokens.colors.danger,
        primary: colors.primary ?? preset.tokens.colors.primary,
        primaryHover: colors["primary-hover"] ?? colors.accent ?? preset.tokens.colors.primaryHover,
        success: colors.success ?? preset.tokens.colors.success,
        surface: colors.surface ?? colors.card ?? preset.tokens.colors.surface,
        surfaceMuted: colors["surface-muted"] ?? colors.muted ?? colors.subtle ?? preset.tokens.colors.surfaceMuted,
        textPrimary: colors["text-primary"] ?? colors.text ?? colors.foreground ?? colors.ink ?? preset.tokens.colors.textPrimary,
        textSecondary: colors["text-secondary"] ?? colors.mutedText ?? colors.secondary ?? preset.tokens.colors.textSecondary
      },
      radius: {
        ...preset.tokens.radius,
        lg: cssLength(rounded.lg ?? rounded.card ?? preset.tokens.radius.lg),
        md: cssLength(rounded.md ?? rounded.radius ?? rounded["border-radius"] ?? preset.tokens.radius.md),
        sm: cssLength(rounded.sm ?? preset.tokens.radius.sm)
      },
      spacing: {
        ...preset.tokens.spacing,
        lg: cssLength(spacing.lg ?? preset.tokens.spacing.lg),
        md: cssLength(spacing.md ?? spacing.base ?? spacing["spacing-unit"] ?? preset.tokens.spacing.md),
        sm: cssLength(spacing.sm ?? preset.tokens.spacing.sm),
        xl: cssLength(spacing.xl ?? preset.tokens.spacing.xl),
        xs: cssLength(spacing.xs ?? preset.tokens.spacing.xs)
      },
      typography: {
        ...preset.tokens.typography,
        fontBody: typography["font-body"] ?? typography.body ?? typography["body-md"] ?? preset.tokens.typography.fontBody,
        fontHeading: typography["font-heading"] ?? typography.heading ?? typography.display ?? typography["display-lg"] ?? preset.tokens.typography.fontHeading
      }
    }
  };
}

function designSpecFromMetadata(metadata: SystemStyleMetadata): DesignSpecTemplate {
  const preset = designSpecPreset(metadata.name);

  return {
    ...preset,
    description: metadata.description || preset.description,
    displayName: formatDisplayName(metadata.name),
    name: metadata.name
  };
}

function productStylePreset(name: string): ProductStyleTemplate {
  const lower = name.toLowerCase();
  if (lower.includes("minimal") || lower.includes("apple")) return productStylePresets.minimal;
  if (lower.includes("enterprise") || lower.includes("ant")) return productStylePresets.enterprise;
  if (lower.includes("airbnb")) return productStylePresets.airbnb;
  return productStylePresets.airtable;
}

function designSpecPreset(name: string): DesignSpecTemplate {
  const lower = name.toLowerCase();
  if (lower.includes("mobile")) return designSpecPresets.mobileFirst;
  if (lower.includes("creative") || lower.includes("brand") || lower.includes("brainstorm")) return designSpecPresets.creative;
  return designSpecPresets.platform;
}

const baseProductStyle: Omit<ProductStyleTemplate, "description" | "displayName" | "name"> = {
  components: {
    buttonPrimary: {
      background: "{colors.primary}",
      borderRadius: "{radius.md}",
      height: "36px",
      paddingX: "12px",
      textColor: "{colors.textPrimary}"
    },
    card: {
      background: "{colors.surface}",
      borderColor: "{colors.border}",
      borderRadius: "{radius.lg}",
      shadow: "{shadow.card}"
    },
    input: {
      background: "{colors.surface}",
      borderColor: "{colors.border}",
      borderRadius: "{radius.md}",
      height: "36px",
      textColor: "{colors.textPrimary}"
    },
    nav: {
      activeBackground: "{colors.surfaceMuted}",
      activeTextColor: "{colors.textPrimary}",
      background: "{colors.surface}",
      textColor: "{colors.textSecondary}"
    }
  },
  tokens: {
    colors: {
      background: "#F7F8FA",
      border: "#E4E4E7",
      danger: "#EF4444",
      primary: "#F59E0B",
      primaryHover: "#FBBF24",
      success: "#22C55E",
      surface: "#FFFFFF",
      surfaceMuted: "#F4F4F5",
      textPrimary: "#18181B",
      textSecondary: "#71717A"
    },
    radius: { lg: "8px", md: "6px", sm: "4px" },
    shadow: {
      card: "0 1px 2px rgba(24, 24, 27, 0.06)",
      panel: "0 12px 32px rgba(24, 24, 27, 0.12)"
    },
    spacing: { lg: "16px", md: "12px", sm: "8px", xl: "24px", xs: "4px" },
    typography: {
      bodySize: "14px",
      captionSize: "12px",
      fontBody: "Inter",
      fontHeading: "Inter",
      fontWeightMedium: 500,
      fontWeightNormal: 400,
      fontWeightSemibold: 600,
      titleSize: "16px"
    }
  }
};

const productStylePresets: Record<string, ProductStyleTemplate> = {
  airtable: {
    ...baseProductStyle,
    description: "清爽、轻量、表格化的生产力工具风格，适合后台、SaaS、运营工具和数据管理产品。",
    displayName: "Airtable",
    name: "airtable"
  },
  airbnb: {
    ...baseProductStyle,
    description: "亲和、消费级、强调醒目主操作和柔和卡片层级的产品风格。",
    displayName: "Airbnb",
    name: "airbnb",
    tokens: {
      ...baseProductStyle.tokens,
      colors: {
        ...baseProductStyle.tokens.colors,
        background: "#FFF8F7",
        danger: "#DC2626",
        primary: "#FF5A5F",
        primaryHover: "#E14C50",
        surfaceMuted: "#FFE8E6"
      }
    }
  },
  enterprise: {
    ...baseProductStyle,
    description: "专业、稳重、适合企业后台和管理系统的风格。",
    displayName: "Enterprise",
    name: "enterprise",
    tokens: {
      ...baseProductStyle.tokens,
      colors: {
        ...baseProductStyle.tokens.colors,
        background: "#F5F7FA",
        border: "#D7DFEA",
        danger: "#DC2626",
        primary: "#2563EB",
        primaryHover: "#1D4ED8",
        success: "#16A34A",
        surfaceMuted: "#EEF2F7",
        textPrimary: "#0F172A",
        textSecondary: "#64748B"
      }
    }
  },
  minimal: {
    ...baseProductStyle,
    components: {
      ...baseProductStyle.components,
      buttonPrimary: {
        ...baseProductStyle.components.buttonPrimary,
        textColor: "#FFFFFF"
      }
    },
    description: "极简、纯净、留白优先的界面风格。",
    displayName: "Minimal",
    name: "minimal",
    tokens: {
      ...baseProductStyle.tokens,
      colors: {
        ...baseProductStyle.tokens.colors,
        background: "#FAFAFA",
        border: "#E5E7EB",
        primary: "#111827",
        primaryHover: "#374151",
        success: "#10B981",
        surfaceMuted: "#F5F5F5",
        textPrimary: "#111827",
        textSecondary: "#6B7280"
      },
      radius: { lg: "12px", md: "8px", sm: "4px" },
      shadow: {
        card: "0 1px 2px rgba(17, 24, 39, 0.04)",
        panel: "0 12px 32px rgba(17, 24, 39, 0.10)"
      }
    }
  }
};

const platformRules: DesignSpecTemplate["rules"] = {
  desktop: {
    rules: {
      allowDenseData: true,
      commandBarHeight: "48px",
      leftRailWidth: "72px",
      preferredColumns: 3,
      primaryActionPlacement: "top command bar"
    },
    structure: ["left rail navigation", "top command bar", "multi-column workspace", "status cards", "data table"],
    template: "desktop-command-center"
  },
  global: {
    contrast: "WCAG AA",
    density: "compact",
    focusRing: "2px amber outline",
    keyboardAccessible: true,
    layoutPrinciple: "信息优先，减少装饰，保持后台工具的扫描效率",
    minTouchTarget: "44px"
  },
  mobile: {
    rules: {
      avoidDenseTables: true,
      bottomAction: true,
      cardPadding: "16px",
      navigation: "top bar + optional bottom action",
      singleColumn: true
    },
    structure: ["top app bar", "stacked cards", "list rows", "bottom primary action"],
    template: "mobile-product-shell"
  },
  tablet: {
    rules: {
      detailPanelVisible: true,
      preferredColumns: 2,
      splitRatio: "40/60",
      toolbarHeight: "48px"
    },
    structure: ["top toolbar", "left list panel", "right detail panel", "secondary cards"],
    template: "tablet-split-view"
  },
  web: {
    rules: {
      buttonPlacement: "top-right of content header",
      contentMaxWidth: "none",
      formLayout: "label above input",
      preferredColumns: 3,
      sidebarWidth: "220px"
    },
    structure: ["top navigation", "left sidebar", "main content", "data cards", "table/list rows", "primary action button"],
    template: "admin-workspace"
  }
};

const designSpecPresets: Record<string, DesignSpecTemplate> = {
  creative: {
    description: "强调快速生成、多方案比较和品牌一致性的设计规范，适合创意生成和内容工作流。",
    displayName: "Creative System",
    name: "creative-system",
    rules: {
      ...platformRules,
      global: {
        ...platformRules.global,
        density: "comfortable",
        focusRing: "2px amber outline",
        layoutPrinciple: "让内容创作流程保持清晰，突出预览、版本和主操作"
      },
      web: {
        ...platformRules.web,
        rules: {
          ...platformRules.web.rules,
          preferredColumns: 2,
          sidebarWidth: "240px"
        }
      }
    }
  },
  mobileFirst: {
    description: "优先从移动端交互出发，强调单手操作与关键行为收敛。",
    displayName: "Mobile First",
    name: "mobile-first",
    rules: {
      ...platformRules,
      desktop: {
        ...platformRules.desktop,
        rules: {
          ...platformRules.desktop.rules,
          allowDenseData: false,
          preferredColumns: 2
        }
      },
      global: {
        ...platformRules.global,
        density: "comfortable",
        focusRing: "2px blue outline",
        layoutPrinciple: "从小屏优先组织信息，再扩展到大屏"
      },
      tablet: {
        ...platformRules.tablet,
        rules: {
          ...platformRules.tablet.rules,
          splitRatio: "45/55"
        }
      },
      web: {
        ...platformRules.web,
        rules: {
          ...platformRules.web.rules,
          contentMaxWidth: "1280px",
          preferredColumns: 2
        }
      }
    }
  },
  platform: {
    description: "跨 Web、Mobile、Tablet、Desktop 的平台化设计规范，强调控件尺寸、导航结构、信息密度和可访问性。",
    displayName: "Platform Design",
    name: "platform-design",
    rules: platformRules
  }
};

function resolveToken(input: string, style: ProductStyleTemplate): string {
  const map: Record<string, string> = {
    "{colors.border}": style.tokens.colors.border,
    "{colors.primary}": style.tokens.colors.primary,
    "{colors.surface}": style.tokens.colors.surface,
    "{colors.surfaceMuted}": style.tokens.colors.surfaceMuted,
    "{colors.textPrimary}": style.tokens.colors.textPrimary,
    "{radius.lg}": style.tokens.radius.lg,
    "{radius.md}": style.tokens.radius.md,
    "{radius.sm}": style.tokens.radius.sm,
    "{shadow.card}": style.tokens.shadow.card
  };

  return map[input] ?? input;
}

function platformLabel(platform: TemplatePlatform): string {
  if (platform === "web") return "Web";
  if (platform === "mobile") return "Mobile";
  if (platform === "tablet") return "Tablet";
  return "Desktop";
}

function formatDisplayName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function px(value: string): number {
  return parseInt(value.replace("px", ""), 10) || 0;
}

function cssLength(value: string): string {
  return /^-?\d+(?:\.\d+)?$/.test(value) && value !== "0" ? `${value}px` : value;
}
