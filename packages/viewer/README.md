# @xenonbyte/forma-viewer

Forma 共享只读查看器:无限画布外壳(左 设计稿列表 / 中 画布 / 右 标注 slot),
设计画布渲染静态 HTML(`<iframe sandbox>` 禁脚本),标注画布渲染 PNG。
纯展示、数据驱动;web(HTTP)/desktop(IPC) 经同一 view-model 契约 + 注入式
资源解析器同源消费。

## 消费模型
- 通过 `exports` 暴露 `./src/index.ts`,消费方(web/desktop,均 Vite)直接打包源码。
- 无独立 build emit;类型检查走 `pnpm --filter @xenonbyte/forma-viewer typecheck`。

## 契约
详见 `src/model.ts`(后续 task 填充本节)。
