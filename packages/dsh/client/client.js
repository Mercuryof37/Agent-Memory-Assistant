/**
 * Agent Memory — DSH client half (P0 probe).
 *
 * Loaded by the host module loader as a Cordis client plugin. It registers:
 *   - a sidebar panel entry "记忆" that selects the `main` panel below;
 *   - the full-page workbench at `main` keyed by `agent-memory`;
 *   - one read-only status fetch against the host's exact Fetch route.
 *
 * Written in the loader's factory form by hand so P0 does not depend on a
 * client build toolchain; P1 will move this to a bundled TypeScript source.
 */
window.__ModuleLoader__.load({
  id: "@agent-memory/dsh",
  factory: (require) => {
    const React = require("react");
    const PANEL_ID = "agent-memory";

    const styles = {
      page: {
        padding: "32px 40px",
        maxWidth: "960px",
        margin: "0 auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      },
      h1: { fontSize: "22px", fontWeight: 600, margin: "0 0 6px" },
      sub: { color: "var(--dsw-text-secondary, #6b7280)", fontSize: "13px", margin: "0 0 24px" },
      row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" },
      card: {
        padding: "16px",
        borderRadius: "12px",
        border: "1px solid var(--dsw-border, #e5e7eb)",
        background: "var(--dsw-surface, #fff)",
      },
      label: { fontSize: "12px", color: "var(--dsw-text-secondary, #6b7280)", margin: "0 0 6px" },
      value: { fontSize: "20px", fontWeight: 600, margin: 0 },
      action: {
        marginTop: "24px",
        padding: "8px 16px",
        borderRadius: "8px",
        border: "1px solid var(--dsw-border, #e5e7eb)",
        background: "transparent",
        cursor: "pointer",
        fontSize: "13px",
      },
      error: { color: "#b91c1c", fontSize: "13px", marginTop: "12px" },
    };

    function metric(label, value) {
      return React.createElement(
        "div",
        { style: styles.card },
        React.createElement("p", { style: styles.label }, label),
        React.createElement("p", { style: styles.value }, value == null ? "—" : String(value)),
      );
    }

    function MemoryPage() {
      const [state, setState] = React.useState({ loading: true });

      const load = () => {
        setState({ loading: true });
        fetch("/api/agent-memory/status", { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => setState({ data }))
          .catch((error) => setState({ error: String(error) }));
      };

      React.useEffect(load, []);

      const data = state.data;
      return React.createElement(
        "div",
        { style: styles.page },
        React.createElement("h1", { style: styles.h1 }, "记忆"),
        React.createElement(
          "p",
          { style: styles.sub },
          "你的 AI 助手记住的事。这里是 P0 探针页面：先确认侧栏入口、页面与只读接口都通了。",
        ),
        state.loading
          ? React.createElement("p", { style: styles.sub }, "正在读取…")
          : React.createElement(
              "div",
              { style: styles.row },
              metric("活动记忆", data && data.active),
              metric("待审提案", data && data.pending),
              metric("写入模式", data && data.mode),
              metric("数据目录", data && data.home),
            ),
        state.error ? React.createElement("p", { style: styles.error }, `读取失败：${state.error}`) : null,
        React.createElement("button", { style: styles.action, onClick: load }, "刷新"),
      );
    }

    function MemoryIcon() {
      return React.createElement(
        "span",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "20px",
            height: "20px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: "6px",
            border: "1px solid var(--dsw-border, #e5e7eb)",
          },
        },
        "记",
      );
    }

    function apply(ctx) {
      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: PANEL_ID }, MemoryPage),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 50, label: () => "记忆" },
          MemoryIcon,
        ),
      );
    }

    const inject = ["slots"];

    return { apply, inject };
  },
});
