# DESIGN v5：页面设计生成与 .pen 持久化原子化

## 背景

当前 `/design` / `$fm-design` 页面设计流程依赖 agent 先调用 `generate_page_design`，再把返回的 `pen_path` / `preview_path` 传给 `save_designs`。这个两步协议已经写进 skill 和文档，但它仍然依赖 prompt/skill 约束 agent 正确执行。

实际风险是：agent 可能只完成 `generate_page_design`，遗漏后续 `save_designs`。此时新生成的 `.pen` 设计稿只存在于临时目录中的 `page.pen`，不会进入 `$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/design.pen`，也不会更新 requirement page 的设计状态、版本历史、预览图、annotations 或 rollback 记录。临时目录一旦被系统或进程清理，新设计稿数据就会丢失。

这类持久化动作不应该依赖 agent 记住多工具串联。现有 `generate_components` 已经在 store 层完成生成、复制和持久化，页面设计生成也应该采用同样的后端编排方式：低层 Pencil 工具负责生成临时产物，store/MCP 原子工具负责把产物保存成正式设计。

因此 v5 要引入一个后端原子工具，让 `/design` 的常规入口一次完成“生成设计稿、保存 `.pen`、保存预览图、推进页面状态、清理临时目录”，避免因 prompt/skill 遗漏导致设计稿悬空。

## 目标

1. 新增后端原子 MCP 工具 `generate_and_save_page_design`，一次完成页面设计生成、持久化、状态推进和临时目录清理。
2. 后端根据 requirement page 的 `change_type` 自动决定设计模式，映射规则为 `new -> generate`、`patch -> refine`、`rebuild -> update`，减少 agent 传错或漏传 mode 的空间。
3. 成功后返回正式持久化后的设计元数据，包括 `design_id`、`version`、`pen_path`、`preview_path`，而不是临时目录路径。
4. 失败时不留下半保存状态：生成失败不写入设计历史；保存失败沿用 `saveDesignsLocked` 的 rollback 保护；临时目录必须被清理或至少产生可观察的清理告警。
5. `/design` / `$fm-design` 改用 `generate_and_save_page_design` 作为默认入口，不再要求 agent 手动串联 `generate_page_design` + `save_designs`。
6. 保留 `generate_page_design` 和 `save_designs` 作为低层/兼容工具，但文档明确标注 `generate_page_design` 只生成临时输出，不适合作为普通 `/design` 工作流入口。

## 非目标

- 不删除 `generate_page_design` 或 `save_designs`
- 不改变 `.pen` 的正式持久化目录结构
- 不重写 `DesignService` 的版本历史、stage、backup 或 rollback 机制
- 不改变 Pencil CLI 的实际生成能力、提示词策略或输出格式
- 不在本版本实现多页面批量事务；需要批量生成时仍可逐页调用原子工具

---

## 当前问题链路

现有链路：

```text
/design 或 $fm-design
  -> agent call generate_page_design
       -> PencilService.generatePageDesign()
       -> tempDir/page.pen
       -> tempDir/preview.png
  -> agent should call save_designs
       -> DesignService.saveDesigns()
       -> $FORMA_HOME/data/{product}/{requirement}/{design}/design.pen
       -> preview@2x.png
```

风险点：

1. `generate_page_design` 的返回路径是临时路径，不是正式设计稿路径。
2. 如果 agent 没有继续调用 `save_designs`，后台无法把该设计纳入状态、历史和回滚链路。
3. skill/prompt 可以降低遗漏概率，但不能提供后端级别的持久化保证。
4. 用户看到“设计完成”时，可能误以为 `.pen` 已保存，但实际只有临时产物。

目标链路：

```text
/design 或 $fm-design
  -> agent call generate_and_save_page_design
       -> store validates product / requirement / page
       -> PencilService.generatePageDesign()
       -> DesignService.saveDesignsLocked()
       -> persisted design.pen + preview@2x.png
       -> cleanup tempDir
  -> return persisted design metadata
```

---

## 方案概览

新增 store 层方法 `generateAndSavePageDesign(input)`，由 MCP 工具 `generate_and_save_page_design` 暴露给 agent。

store 层负责把低层能力组合成一个不可遗漏的业务动作：

1. 校验 product 配置和组件库状态。
2. 读取 requirement，并找到目标 page。
3. 根据 page 的 `change_type` 推导生成 mode。
4. 调用 `PencilService.generatePageDesign()` 生成临时 `.pen` 和 preview。
5. 调用 `DesignService.saveDesignsLocked()` 将临时产物保存为正式设计。
6. 返回正式设计的 metadata。
7. 在 `finally` 中清理临时目录。

`generate_page_design` 仍保留为低层工具，用于调试、兼容旧 agent、或非常规工作流。但默认 agent 模板和 `/design` 文档必须改为只调用新原子工具。

---

## API 设计

### MCP Tool

名称：

```text
generate_and_save_page_design
```

输入：

```typescript
const generateAndSavePageDesignSchema = z.object({
  product_id: z.string().min(1),
  requirement_id: z.string().min(1),
  page_id: z.string().min(1),
  prompt: z.string().min(1),
  workspace: z.string().min(1)
}).strict();
```

返回：

```typescript
{
  product_id: string;
  requirement_id: string;
  page_id: string;
  design_id: string;
  version: number;
  pen_path: string;
  preview_path: string;
}
```

返回路径必须是正式持久化路径，例如：

```text
$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/design.pen
$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/preview@2x.png
```

不能返回 `tempDir/page.pen` 作为成功结果。

### Mode 映射

后端根据 requirement page 的 `change_type` 推导 `DesignService` 保存 mode：

| page.change_type | mode |
| --- | --- |
| `new` | `generate` |
| `patch` | `refine` |
| `rebuild` | `update` |

如果 page 缺失、`change_type` 非法、或 product/requirement 不匹配，工具应该显式失败，而不是猜测默认 mode。

---

## Core 实现

文件：

- `packages/core/src/store.ts`
- `packages/core/src/pencil.ts`
- `packages/core/src/design.ts`

### Store 方法

在 `createFormaStore()` 中新增方法：

```typescript
generateAndSavePageDesign(input: GenerateAndSavePageDesignInput): Promise<GenerateAndSavePageDesignResult>
```

建议实现骨架：

```typescript
async function generateAndSavePageDesign(input: GenerateAndSavePageDesignInput) {
  return runProductMutation({ operation: "generate_and_save_page_design", product_id: input.product_id }, async () => {
    const product = await products.getProduct(input.product_id);
    assertProductConfig(product, input.product_id, ["platform", "style", "languages", "components_initialized"]);

    const requirement = await requirements.getRequirement({ requirement_id: input.requirement_id });
    if (requirement.product_id !== input.product_id) {
      throw new Error("Requirement does not belong to product");
    }

    const page = requirement.pages.find((candidate) => candidate.page_id === input.page_id);
    if (!page) {
      throw new Error("Page not found in requirement");
    }

    const mode = modeFromPageChangeType(page.change_type);
    const generated = await pencil.generatePageDesign({
      product_id: input.product_id,
      prompt: input.prompt,
      workspace: input.workspace
    });

    let committed = false;
    try {
      const saved = await designs.saveDesignsLocked(input.requirement_id, [{
        page_id: input.page_id,
        mode,
        penPath: generated.penPath,
        previewPath: generated.previewPath
      }]);
      committed = true;

      const design = saved.find((candidate) => candidate.page_id === input.page_id);
      if (!design) {
        throw new Error("Saved design metadata missing for page");
      }

      const metadata = await designs.getDesignMetadata(design.id);
      const result = {
        product_id: input.product_id,
        requirement_id: input.requirement_id,
        page_id: input.page_id,
        design_id: metadata.id,
        version: metadata.version,
        pen_path: metadata.pen_path,
        preview_path: metadata.preview_path
      };
      await cleanupGeneratedOutput(generated.tempDir, "committed");
      return result;
    } catch (error) {
      await cleanupGeneratedOutput(generated.tempDir, committed ? "committed" : "failed");
      throw error;
    }
  });
}
```

说明：

- 外层使用 `runProductMutation(input, fn)`，和 `generateComponents()` 保持一致，避免同一产品的生成和保存互相交错。
- 内部调用 `saveDesignsLocked()`，不要调用公开的 `saveDesigns()`，避免在 product mutation lock 内再次获取同一层锁。
- `PencilService.generatePageDesign()` 当前只接收 `product_id`、`prompt`、`workspace`，不接收 `requirement_id`、`page_id` 或 `mode`；mode 只传给 `DesignService.saveDesignsLocked()`。
- `GeneratedDesign` 当前返回 `tempDir`、`penPath`、`previewPath`，实现时应沿用这些字段名，不要改成 snake_case。
- `saveDesignsLocked()` 当前返回 `Design[]`，`Design` 不包含正式文件路径；保存后应调用 `designs.getDesignMetadata(design.id)` 取得 `pen_path` 和 `preview_path`。
- 如果需要 mock Pencil 生成页面设计，`FormaStoreOptions` 应新增独立的 `pageDesignGenerator`，或把现有 `pencilService` 扩展成同时支持 `generatePageDesign()` 和 `generateComponents()`；不要让测试调用真实 Pencil CLI。

### 临时目录清理

规则：

1. `PencilService.generatePageDesign()` 自身生成失败时，继续由 PencilService 清理其已创建的临时目录。
2. 生成成功但保存失败时，store 层清理临时目录，并重新抛出保存失败的原始错误；如果清理也失败，只记录 warning，不能覆盖原始保存错误。
3. 保存成功后清理失败，不应该回滚已经正式保存的设计；应记录 warning，返回成功结果。
4. 清理逻辑应只删除本次生成返回的 tempDir，不能对 workspace 或 `$FORMA_HOME/data` 做递归清理。

推荐把清理封装成带语义参数的 helper：

```typescript
async function cleanupGeneratedOutput(tempDir: string, outcome: "committed" | "failed"): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    onProductMutationWarning(`Failed to cleanup generated design temp dir after ${outcome}: ${tempDir}`);
  }
}
```

---

## MCP 实现

文件：

- `packages/mcp/src/tools.ts`

新增 tool name、store interface、schema、description 和 handler。当前 MCP 实现直接注册 Zod schema，不使用 `zodToJsonSchema`。

```typescript
export const formaToolNames = [
  // ...
  "generate_page_design",
  "generate_and_save_page_design",
  "generate_components",
  // ...
] as const;

export interface FormaStore {
  // ...
  generateAndSavePageDesign?(input: GenerateAndSavePageDesignInput): Promise<GenerateAndSavePageDesignResult>;
}

const generateAndSavePageDesignSchema = z.object({
  product_id: z.string().min(1),
  requirement_id: z.string().min(1),
  page_id: z.string().min(1),
  prompt: z.string().min(1),
  workspace: z.string().min(1)
}).strict();

export const formaToolInputSchemas = {
  // ...
  generate_page_design: pencilGenerationSchema,
  generate_and_save_page_design: generateAndSavePageDesignSchema,
  generate_components: componentGenerationSchema,
  // ...
} satisfies Record<FormaToolName, z.ZodType>;

const descriptions = {
  // ...
  generate_page_design: "Generate temporary Pencil output for a page design. Prefer generate_and_save_page_design for normal /design workflows.",
  generate_and_save_page_design: "Generate a page design and persist the resulting .pen and preview as the official design in one workflow.",
  // ...
} satisfies Record<FormaToolName, string>;
```

handler：

```typescript
generate_and_save_page_design: tool("generate_and_save_page_design", async (input) => {
  if (typeof store.generateAndSavePageDesign !== "function") {
    throw new ToolError("STORE_METHOD_UNAVAILABLE", "Store page design generation is unavailable", {});
  }
  return store.generateAndSavePageDesign(input);
})
```

文案要求：

- description 必须明确这是普通 `/design` 工作流的推荐入口。
- `generate_page_design` 的 description 要补充“temporary output only; call `save_designs` or prefer `generate_and_save_page_design` for normal workflows”。
- 不改变旧工具入参，避免破坏已有调用方。

---

## Agent 模板更新

文件：

- `packages/agent/templates/codex/fm-design/SKILL.md`
- `packages/agent/templates/claude/fm-design.md`
- `packages/agent/templates/gemini/fm-design.toml`

模板规则改为：

1. 常规页面设计必须调用 `generate_and_save_page_design`。
2. 不再要求 agent 在成功 `generate_page_design` 后手动调用 `save_designs`。
3. 如果为了调试或兼容必须调用 `generate_page_design`，模板必须显式说明它只产生临时输出，后续必须保存，否则设计稿可能丢失。
4. 成功结果展示给用户时使用新工具返回的正式 `pen_path` 和 `preview_path`。

推荐执行段：

```markdown
Execution:
1. Resolve the active product and requirement.
2. For each target page, call MCP `generate_and_save_page_design` with `product_id`, `requirement_id`, `page_id`, `prompt`, and `workspace`.
3. Report the persisted `design_id`, `version`, `pen_path`, and `preview_path`.

Do not use `generate_page_design` as the normal workflow entrypoint. It only creates temporary files and can lose the new design if `save_designs` is skipped.
```

---

## 文档更新

文件：

- `docs/MCP.md`
- `docs/AGENT.md`
- `README.md`

需要同步说明：

1. `generate_and_save_page_design` 是页面设计生成的推荐入口。
2. `generate_page_design` 只创建临时 Pencil 输出，不会持久化为正式设计。
3. 正式设计稿保存路径仍是 `$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/design.pen`。
4. 后台、历史、回滚和 preview 只读取持久化后的 design metadata，不读取临时目录。

---

## 测试计划

### Core

覆盖 `generateAndSavePageDesign()`：

1. 成功路径：生成临时 `.pen` 和 preview 后保存为正式设计，返回正式路径。
2. 漏保存防护：只调用新 store 方法时，设计已经出现在 requirement page metadata 中。
3. mode 映射：`new`、`patch`、`rebuild` 分别映射到 `generate`、`refine`、`update`。
4. product/requirement/page 不匹配时显式失败。
5. `saveDesignsLocked()` 失败时执行 rollback，并清理临时目录。
6. 保存成功但清理失败时返回成功，同时产生可观察 warning。

建议命令：

```bash
pnpm test -- packages/core/tests/design.test.ts
pnpm test -- packages/core/tests/product-session-style.test.ts
pnpm --filter @xenonbyte/forma-core typecheck
```

### MCP

覆盖工具注册和 handler：

1. `generate_and_save_page_design` 出现在 MCP tools 列表。
2. handler 调用 `store.generateAndSavePageDesign()`。
3. schema 拒绝缺失 `product_id`、`requirement_id`、`page_id`、`prompt`、`workspace` 的输入。
4. `generate_page_design` description 已标明 temporary output only。

建议命令：

```bash
pnpm test -- packages/mcp/tests/tools.test.ts
pnpm --filter @xenonbyte/forma-mcp typecheck
```

### Agent 模板

覆盖方式：

1. `rg "generate_and_save_page_design" packages/agent/templates`
2. `rg "generate_page_design" packages/agent/templates`

验收要求：

- 常规设计流程只推荐 `generate_and_save_page_design`。
- 旧两步工具不再出现在默认执行步骤中。
- 如果保留旧工具说明，必须强调它是临时输出工具。

---

## 迁移与兼容

1. 现有已保存设计不需要迁移，因为持久化目录结构不变。
2. 旧 agent 仍可继续调用 `generate_page_design` + `save_designs`，但文档会明确该路径是兼容/低层路径。
3. 新 agent 安装或更新 skill 后，默认走 `generate_and_save_page_design`。
4. 如果用户在旧版本中只生成了临时 `.pen` 而没有保存，系统无法保证该临时文件仍存在；这类悬空设计不纳入自动迁移范围。

---

## 验收标准

1. `/design` 完成后，返回的 `pen_path` 必须指向 `$FORMA_HOME/data/.../design.pen`，不能指向临时目录。
2. 后台刷新后能看到新设计预览、版本和状态。
3. 退出 agent 或清理临时目录后，已完成的设计仍可打开。
4. 故意让 `saveDesignsLocked()` 抛错时，requirement page 不出现半保存设计。
5. 文档和 agent 模板不再把“两步调用”作为默认流程。

---

## 回滚方案

如果新工具上线后出现问题：

1. 从 agent 模板中恢复旧的 `generate_page_design` + `save_designs` 两步流程。
2. 保留已经通过新工具保存的设计数据，因为它们使用同一套 `DesignService` 持久化结构。
3. 临时禁用 MCP tool handler 或从工具列表隐藏 `generate_and_save_page_design`。
4. 不需要迁移或删除 `$FORMA_HOME/data` 下的正式设计稿。
