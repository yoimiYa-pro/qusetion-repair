# 黄金样例与人工验收清单

本仓库在 `packages/core/fixtures/` 下提供 5 组文本输入样例（`golden-01` … `golden-05`）以及 1 份模拟模型 JSON 输出（`golden-model-output.json`）。其中 JSON 样例由 Vitest 做快照回归；文本样例用于端到端人工验收。

## 自动化回归（无需调用大模型）

在仓库根目录执行：

```bash
npm test
```

其中 `golden-model-output.json` 必须通过 JSON Schema 校验，且渲染出的 Markdown 与快照一致。升级提示词或调整 Schema / 渲染器后，若快照失败，请审阅差异并决定更新快照或修复代码。

## 端到端人工验收（需要 `MOONSHOT_API_KEY` 或 `OPENAI_API_KEY`）

1. 启动后端：`npm run dev:server`（或在 `apps/server` 下配置 `.env` 后 `npm run dev`）。
2. 启动前端：`npm run dev:web`，浏览器打开提示的本地地址。
3. 选择「纯文本」，将 `golden-01-quadratic.txt` 全文粘贴到文本框，点击「开始分析」，直到状态为 `done`。
4. 下载 `.md`，检查是否包含：题干、作答、解析、知识点标签；**不得**出现与输入明显矛盾的编造数值。
5. 对 `golden-02` … `golden-05` 重复上述流程：
   - `golden-03`、`golden-05` 应在解析或标签中出现「待确认」或等价谨慎表述（允许措辞不同，但不应武断下结论）。
   - `golden-04` 应拆成 **2 道** `items`（或等价结构），或单一 `item` 中明确分点两题（以最终模板可读性为准）。
6. 任选一张清晰错题照片，用「错题图片」模式上传，确认可下载 Markdown 且公式以 `$...$` / `$$...$$` 形式合理呈现。

## 模型升级后回归

更换 `MOONSHOT_MODEL` / `OPENAI_MODEL`、或切换 `LLM_PROVIDER` 后，请重新执行「自动化回归」与至少 `golden-01`、`golden-03`、`golden-05` 三组端到端用例，确认输出风格仍符合「不确定则待确认」与 Schema 约束。
