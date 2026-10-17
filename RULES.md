# 规则（RULES.md）

编号稳定、不复用；废止的条目保留编号并标 `[废止]`。`[机器门禁]` 必须三件齐全：`check:`（符号存在）、`test:`（文件存在）、该测试文件里至少一个标题带 `[neg]` 的负向用例。

1. [机器门禁] 工具层写记忆只能经过 `mem add`（模型工具在 S4 注册，且不暴露删除）。
   check: packages/cli/src/main.ts#commandAdd
   test: packages/core/test/rules/rules.test.ts
2. [模型指引] 收尾时优先把可复用的纠正写成 pitfall，并在摘要里点名错误码；不要把建议说成系统级承诺。
3. [废止] 早期“自动后台整合/自动删除”条款，V1 不做。
