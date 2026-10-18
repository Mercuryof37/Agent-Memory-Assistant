/**
 * Agent Memory — DSH client half (V2 P1 workbench).
 *
 * Read-only workbench: grouped memory list (F-01/P-02/E-03 serials, newest
 * first inside each kind), detail with provenance, keyword search, JSON export
 * and a small command-manual button. All data comes from the host's
 * `/api/agent-memory/*` routes; this file never touches files.
 *
 * Kept in the loader's factory form by hand until the client build toolchain
 * lands (P1 follow-up); the surface is React + the host slot registry only.
 */
window.__ModuleLoader__.load({
  id: "@agent-memory/dsh",
  factory: (require) => {
    const React = require("react");
    const PANEL_ID = "agent-memory";

    const KIND_STYLE = {
      fact: { label: "事实", color: "#2563eb", background: "#eff6ff" },
      pitfall: { label: "坑", color: "#b45309", background: "#fffbeb" },
      exp: { label: "经验", color: "#047857", background: "#ecfdf5" },
    };

    const styles = {
      page: {
        padding: "28px 40px 48px",
        maxWidth: "1080px",
        margin: "0 auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "var(--dsw-text, #111827)",
      },
      header: { display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "4px" },
      h1: { fontSize: "22px", fontWeight: 600, margin: 0 },
      meta: { color: "var(--dsw-text-secondary, #6b7280)", fontSize: "13px" },
      toolbar: { display: "flex", gap: "8px", alignItems: "center", margin: "18px 0 22px" },
      input: {
        flex: "1 1 320px",
        padding: "8px 12px",
        borderRadius: "8px",
        border: "1px solid var(--dsw-border, #e5e7eb)",
        background: "var(--dsw-surface, #fff)",
        fontSize: "13px",
      },
      button: {
        padding: "7px 12px",
        borderRadius: "8px",
        border: "1px solid var(--dsw-border, #e5e7eb)",
        background: "transparent",
        color: "var(--dsw-text, #111827)",
        cursor: "pointer",
        fontSize: "13px",
        whiteSpace: "nowrap",
      },
      buttonPrimary: {
        padding: "7px 12px",
        borderRadius: "8px",
        border: "1px solid var(--dsw-accent, #2563eb)",
        background: "var(--dsw-accent, #2563eb)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "13px",
        whiteSpace: "nowrap",
      },
      small: { fontSize: "12px", color: "var(--dsw-text-secondary, #6b7280)" },
      danger: { color: "#b91c1c", borderColor: "#fecaca" },
      textarea: {
        width: "100%",
        minHeight: "140px",
        padding: "10px 12px",
        borderRadius: "8px",
        border: "1px solid var(--dsw-border, #e5e7eb)",
        background: "var(--dsw-surface, #fff)",
        fontSize: "13px",
        lineHeight: 1.6,
        fontFamily: "inherit",
        boxSizing: "border-box",
        resize: "vertical",
      },
      card: {
        padding: "14px 16px",
        border: "1px solid var(--dsw-border, #e5e7eb)",
        borderRadius: "10px",
        background: "var(--dsw-surface, #fff)",
        marginBottom: "8px",
      },
      actions: { display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" },
      notice: { fontSize: "12px", color: "#047857", margin: "8px 0 0" },
      groupTitle: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        margin: "22px 0 8px",
        fontSize: "13px",
        fontWeight: 600,
      },
      count: { color: "var(--dsw-text-secondary, #6b7280)", fontWeight: 400 },
      list: { display: "flex", flexDirection: "column", gap: "6px" },
      row: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 12px",
        borderRadius: "10px",
        border: "1px solid transparent",
        background: "var(--dsw-surface, #fff)",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        fontSize: "14px",
      },
      serial: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "12px",
        padding: "2px 6px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
      },
      abstract: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      date: { fontSize: "12px", color: "var(--dsw-text-secondary, #6b7280)", whiteSpace: "nowrap" },
      empty: {
        padding: "40px 16px",
        textAlign: "center",
        color: "var(--dsw-text-secondary, #6b7280)",
        border: "1px dashed var(--dsw-border, #e5e7eb)",
        borderRadius: "12px",
        fontSize: "13px",
      },
      detail: {
        marginTop: "20px",
        padding: "20px",
        border: "1px solid var(--dsw-border, #e5e7eb)",
        borderRadius: "12px",
        background: "var(--dsw-surface, #fff)",
      },
      detailTitle: { fontSize: "16px", fontWeight: 600, margin: "0 0 8px" },
      body: {
        whiteSpace: "pre-wrap",
        fontSize: "13px",
        lineHeight: 1.7,
        margin: "12px 0 0",
        padding: "12px",
        borderRadius: "8px",
        background: "var(--dsw-hover, #f9fafb)",
        fontFamily: "inherit",
      },
      provenance: {
        marginTop: "12px",
        paddingLeft: "18px",
        fontSize: "12px",
        color: "var(--dsw-text-secondary, #6b7280)",
        lineHeight: 1.7,
      },
      overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(17, 24, 39, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      },
      modal: {
        width: "min(560px, calc(100vw - 48px))",
        maxHeight: "70vh",
        overflow: "auto",
        background: "var(--dsw-surface, #fff)",
        borderRadius: "14px",
        padding: "22px 24px",
        boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
      },
      pre: {
        margin: "12px 0 0",
        padding: "12px",
        borderRadius: "8px",
        background: "var(--dsw-hover, #f9fafb)",
        fontSize: "12px",
        lineHeight: 1.8,
        whiteSpace: "pre-wrap",
      },
    };

    const MANUAL = [
      "常用命令（在聊天框输入，无需终端）：",
      "/mem proposals              查看待审提案",
      "/mem review                 逐条弹出审批卡",
      "/mem recall <关键词>        检索记忆",
      "/mem read <库编号>          查看全文与出处（如 F-01）",
      "/mem profile                查看你的偏好",
      "/mem export <目录>          完整备份",
      "/mem inspect                一屏概况",
      "/mem help                   全部命令",
      "",
      "日常不需要命令：在「记忆」页里点条目即可查看；修订与偏好修改都会先弹卡片确认。",
      "编号一律是库编号（F-01 / P-01 / E-01），不是长串内部 ID。",
    ].join("\n");

    // Chrome-like scrollbar for the workbench. The host does not scroll our
    // main panel, so the page owns a viewport-height scroll container; this
    // stylesheet keeps the rail thin and unobtrusive in both themes.
    const SCROLL_CSS = [
      ".am-memory-scroll{scrollbar-width:thin;scrollbar-color:rgba(120,120,128,.45) transparent;overscroll-behavior:contain}",
      ".am-memory-scroll::-webkit-scrollbar{width:12px;height:12px}",
      ".am-memory-scroll::-webkit-scrollbar-track{background:transparent}",
      ".am-memory-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#9ca3af) 42%,transparent);border:3px solid transparent;background-clip:padding-box;border-radius:999px}",
      ".am-memory-scroll::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#9ca3af) 65%,transparent);background-clip:padding-box}",
    ].join("\n");

    function ensureScrollbarStyles() {
      if (typeof document === "undefined" || document.getElementById("am-memory-scroll")) return;
      const style = document.createElement("style");
      style.id = "am-memory-scroll";
      style.textContent = SCROLL_CSS;
      document.head.appendChild(style);
    }

    function badge(kind, serial) {
      const style = KIND_STYLE[kind] || { color: "#374151", background: "#f3f4f6" };
      return React.createElement(
        "span",
        { style: { ...styles.serial, color: style.color, background: style.background } },
        serial || "—",
      );
    }

    function metric(label, value) {
      return React.createElement(
        "span",
        { style: styles.meta },
        `${label} ${value == null ? "—" : String(value)}`,
        "\u00a0\u00a0",
      );
    }

    function MemoryPage() {
      const [state, setState] = React.useState({ loading: true });
      const [detail, setDetail] = React.useState(null);
      const [query, setQuery] = React.useState("");
      const [search, setSearch] = React.useState(null);
      const [manual, setManual] = React.useState(false);
      const rootRef = React.useRef(null);
      const [viewportHeight, setViewportHeight] = React.useState(null);
      const [panel, setPanel] = React.useState(null);
      const [proposals, setProposals] = React.useState([]);
      const [profileText, setProfileText] = React.useState("");
      const [rulesText, setRulesText] = React.useState("");
      const [notice, setNotice] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [revise, setRevise] = React.useState(null);

      // Own the scroll viewport: the host page container does not scroll in a
      // windowed desktop window, so measure the distance from the panel top to
      // the window bottom and pin the scroll container to it.
      React.useEffect(() => {
        const measure = () => {
          const element = rootRef.current;
          if (!element) return;
          const top = element.getBoundingClientRect().top;
          setViewportHeight(Math.max(240, window.innerHeight - top));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
      }, []);

      const load = () => {
        setState({ loading: true });
        fetch("/api/agent-memory/list", { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => setState({ data }))
          .catch((error) => setState({ error: String(error) }));
      };

      React.useEffect(load, []);

      const openItem = (id) => {
        setDetail({ loading: true });
        fetch(`/api/agent-memory/item?id=${encodeURIComponent(id)}`, { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => setDetail({ data }))
          .catch((error) => setDetail({ error: String(error) }));
      };

      const runSearch = () => {
        const text = query.trim();
        if (text === "") {
          setSearch(null);
          return;
        }
        fetch(`/api/agent-memory/search?q=${encodeURIComponent(text)}`, { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => setSearch(data))
          .catch((error) => setSearch({ error: String(error) }));
      };

      const exportNow = () => {
        const link = document.createElement("a");
        link.href = "/api/agent-memory/export";
        link.download = "agent-memory.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
      };

      const postJson = (url, body) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
          return data;
        });

      const refreshProposals = () =>
        fetch("/api/agent-memory/proposals", { headers: { accept: "application/json" } })
          .then((response) => (response.ok ? response.json() : []))
          .then((data) => setProposals(Array.isArray(data) ? data : []))
          .catch(() => setProposals([]));

      const openProposals = () => {
        setPanel("proposals");
        setNotice("");
        refreshProposals();
      };

      const openSettings = () => {
        setPanel("settings");
        setNotice("");
        fetch("/api/agent-memory/profile", { headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((data) => setProfileText((data.entries || []).join("\n\n---\n\n")))
          .catch(() => setNotice("读取偏好失败"));
        fetch("/api/agent-memory/rules", { headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((data) => setRulesText(data.text || ""))
          .catch(() => setNotice("读取规则失败"));
      };

      const decide = (id, decision) => {
        setBusy(true);
        setNotice("");
        postJson("/api/agent-memory/proposals/decide", { id, decision })
          .then(() => {
            setNotice(decision === "accept" ? "已采纳。" : "已驳回。");
            load();
            return refreshProposals();
          })
          .catch((error) => setNotice(`操作失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
      };

      const startRevise = () => {
        if (!detail || !detail.data) return;
        setRevise({ abstract: detail.data.abstract, body: detail.data.body });
      };

      const saveRevise = () => {
        if (!revise || !detail || !detail.data) return;
        setBusy(true);
        postJson("/api/agent-memory/revise", {
          id: detail.data.id,
          abstract: revise.abstract,
          body: revise.body,
        })
          .then(() => {
            setNotice("已修订，旧记录已失效。");
            setDetail(null);
            setRevise(null);
            allReload();
          })
          .catch((error) => setNotice(`修订失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
      };

      const removeItem = () => {
        if (!detail || !detail.data) return;
        if (!window.confirm("删除后不可恢复（journal 仍保留记录）。确定删除？")) return;
        setBusy(true);
        postJson("/api/agent-memory/delete", { id: detail.data.id })
          .then(() => {
            setNotice("已删除。");
            setDetail(null);
            allReload();
          })
          .catch((error) => setNotice(`删除失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
      };

      const saveProfileNow = () => {
        const entries = profileText
          .split(/\n\s*---\s*\n/)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "");
        setBusy(true);
        postJson("/api/agent-memory/profile", { entries })
          .then(() => setNotice("偏好已保存，下一轮注入生效。"))
          .catch((error) => setNotice(`保存失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
      };

      const saveRulesNow = () => {
        if (!window.confirm("保存规则会立即封存并影响下一轮注入。确定保存？")) return;
        setBusy(true);
        postJson("/api/agent-memory/rules", { text: rulesText })
          .then(() => setNotice("规则已保存并重新封存。"))
          .catch((error) => setNotice(`保存失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
      };

      const allReload = () => {
        load();
        refreshProposals();
      };

      const data = state.data;
      const total = data ? data.total : "—";
      const pending = data ? data.pending : "—";

      const renderRows = (items) =>
        items.map((item) =>
          React.createElement(
            "button",
            { key: item.id, style: styles.row, onClick: () => openItem(item.id) },
            badge(item.kind, item.serial),
            React.createElement("span", { style: styles.abstract }, item.abstract),
            React.createElement("span", { style: styles.date }, item.valid_from || item.created_at.slice(0, 10)),
          ),
        );

      return React.createElement(
        "div",
        {
          ref: rootRef,
          className: "am-memory-scroll",
          style: {
            width: "100%",
            height: viewportHeight === null ? "100vh" : viewportHeight,
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
          },
        },
        React.createElement(
          "div",
          { style: styles.page },
          React.createElement(
            "div",
            { style: styles.header },
          React.createElement("h1", { style: styles.h1 }, "记忆"),
          metric("共", total),
          metric("待审", pending),
        ),
        React.createElement(
          "p",
          { style: { ...styles.meta, margin: "2px 0 0" } },
          data && data.modules && data.modules.some((module) => !module.ok)
            ? `部分模块不可用：${data.modules
                .filter((module) => !module.ok)
                .map((module) => module.name)
                .join("、")}`
            : "这里是助手记住的事。点一条查看原文与出处；修订会先弹卡片确认。",
        ),
        React.createElement(
          "div",
          { style: styles.toolbar },
          React.createElement("input", {
            style: styles.input,
            placeholder: "搜索记忆（关键词）",
            value: query,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") runSearch();
            },
          }),
          React.createElement("button", { style: styles.buttonPrimary, onClick: runSearch }, "搜索"),
          React.createElement("button", { style: styles.button, onClick: exportNow }, "导出备份"),
          React.createElement("button", { style: styles.button, onClick: openProposals }, `提案 ${data ? data.pending : ""}`.trim()),
          React.createElement("button", { style: styles.button, onClick: openSettings }, "偏好与规则"),
          React.createElement("button", { style: styles.button, onClick: () => setManual(true) }, "命令手册"),
        ),
        notice ? React.createElement("p", { style: styles.notice }, notice) : null,
        panel === "proposals"
          ? React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { style: styles.groupTitle },
                "待审提案",
                React.createElement("span", { style: styles.count }, ` · ${proposals.length}`),
              ),
              proposals.length === 0
                ? React.createElement("div", { style: styles.empty }, "没有待审提案。")
                : proposals.map((proposal) =>
                    React.createElement(
                      "div",
                      { key: proposal.id, style: styles.card },
                      React.createElement(
                        "p",
                        { style: { margin: 0, fontSize: "14px", fontWeight: 600 } },
                        `${proposal.op === "delete" ? "删除" : "修订"} · ${proposal.targets
                          .map((target) => target.display || target.abstract)
                          .join("、")}`,
                      ),
                      React.createElement("p", { style: styles.small }, proposal.reason || "（无说明）"),
                      proposal.replacements.map((replacement, index) =>
                        React.createElement(
                          "p",
                          { key: index, style: { ...styles.small, margin: "6px 0 0" } },
                          `新内容：${replacement.display || replacement.abstract}`,
                        ),
                      ),
                      React.createElement(
                        "div",
                        { style: styles.actions },
                        React.createElement(
                          "button",
                          { style: styles.buttonPrimary, disabled: busy, onClick: () => decide(proposal.id, "accept") },
                          "采纳",
                        ),
                        React.createElement(
                          "button",
                          { style: styles.button, disabled: busy, onClick: () => decide(proposal.id, "reject") },
                          "驳回",
                        ),
                      ),
                    ),
                  ),
              React.createElement("button", { style: styles.button, onClick: () => setPanel(null) }, "返回列表"),
            )
          : panel === "settings"
            ? React.createElement(
                "div",
                null,
                React.createElement("h2", { style: styles.groupTitle }, "偏好（USER.md）"),
                React.createElement("textarea", {
                  style: styles.textarea,
                  value: profileText,
                  onChange: (event) => setProfileText(event.target.value),
                  placeholder: "一条偏好一段，段与段之间用 --- 分隔",
                }),
                React.createElement(
                  "div",
                  { style: styles.actions },
                  React.createElement("button", { style: styles.buttonPrimary, disabled: busy, onClick: saveProfileNow }, "保存偏好"),
                ),
                React.createElement("h2", { style: styles.groupTitle }, "规则（RULES.md，仅限你在此处修改）"),
                React.createElement("textarea", {
                  style: styles.textarea,
                  value: rulesText,
                  onChange: (event) => setRulesText(event.target.value),
                }),
                React.createElement(
                  "div",
                  { style: styles.actions },
                  React.createElement("button", { style: styles.buttonPrimary, disabled: busy, onClick: saveRulesNow }, "保存并重新封存"),
                  React.createElement("span", { style: styles.small }, "保存后立即封存，下一轮注入生效。"),
                ),
                React.createElement("button", { style: { ...styles.button, marginTop: "12px" }, onClick: () => setPanel(null) }, "返回列表"),
              )
            : null,
        panel !== null
          ? null
          : state.loading
            ? React.createElement("p", { style: styles.meta }, "正在读取…")
          : state.error
            ? React.createElement("p", { style: styles.meta }, `读取失败：${state.error}`)
            : search
              ? React.createElement(
                  "div",
                  null,
                  React.createElement("h2", { style: styles.groupTitle }, `搜索「${search.query || query}」`),
                  search.error
                    ? React.createElement("p", { style: styles.meta }, `搜索失败：${search.error}`)
                    : React.createElement(
                        "div",
                        { style: styles.list },
                        (search.hits || []).length === 0
                          ? React.createElement("div", { style: styles.empty }, "没有匹配的记忆。")
                          : search.hits.map((hit) =>
                              React.createElement(
                                "button",
                                { key: hit.id, style: styles.row, onClick: () => openItem(hit.id) },
                                badge(hit.kind, hit.serial),
                                React.createElement("span", { style: styles.abstract }, hit.abstract),
                                React.createElement("span", { style: styles.date }, hit.provenance_verifiable ? "有出处" : "无出处"),
                              ),
                            ),
                      ),
                )
              : (data.groups || []).map((group) =>
                  React.createElement(
                    "div",
                    { key: group.kind },
                    React.createElement(
                      "h2",
                      { style: styles.groupTitle },
                      KIND_STYLE[group.kind] ? KIND_STYLE[group.kind].label : group.label,
                      React.createElement("span", { style: styles.count }, ` · ${group.items.length}`),
                    ),
                    group.items.length === 0
                      ? React.createElement("div", { style: styles.empty }, "这一类还没有记忆。")
                      : React.createElement("div", { style: styles.list }, renderRows(group.items)),
                  ),
                ),
        detail
          ? React.createElement(
              "div",
              { style: styles.detail },
              detail.loading
                ? React.createElement("p", { style: styles.meta }, "正在读取…")
                : detail.error
                  ? React.createElement("p", { style: styles.meta }, `读取失败：${detail.error}`)
                  : React.createElement(
                      "div",
                      null,
                      React.createElement(
                        "div",
                        { style: { display: "flex", alignItems: "center", gap: "8px" } },
                        badge(detail.data.kind, detail.data.serial),
                        React.createElement("h2", { style: styles.detailTitle }, detail.data.abstract),
                      ),
                      React.createElement(
                        "p",
                        { style: styles.small },
                        `${detail.data.serial || "—"} · ${KIND_STYLE[detail.data.kind] ? KIND_STYLE[detail.data.kind].label : detail.data.kind} · ${detail.data.author === "human" ? "人工维护" : "助手记录"} · ${detail.data.valid_from}`,
                      ),
                      React.createElement("pre", { style: styles.body }, detail.data.body),
                      (detail.data.provenance || []).length > 0
                        ? React.createElement(
                            "ul",
                            { style: styles.provenance },
                            detail.data.provenance.map((entry, index) =>
                              React.createElement(
                                "li",
                                { key: index },
                                `${entry.speaker === "user" ? "用户" : entry.speaker} #${entry.event_seq}：「${entry.quote}」`,
                              ),
                            ),
                          )
                        : null,
                      revise
                        ? React.createElement(
                            "div",
                            { style: { marginTop: "14px" } },
                            React.createElement("input", {
                              style: styles.input,
                              value: revise.abstract,
                              onChange: (event) => setRevise({ ...revise, abstract: event.target.value }),
                              placeholder: "一句话摘要",
                            }),
                            React.createElement("textarea", {
                              style: { ...styles.textarea, marginTop: "8px" },
                              value: revise.body,
                              onChange: (event) => setRevise({ ...revise, body: event.target.value }),
                            }),
                            React.createElement(
                              "div",
                              { style: styles.actions },
                              React.createElement("button", { style: styles.buttonPrimary, disabled: busy, onClick: saveRevise }, "保存修订"),
                              React.createElement("button", { style: styles.button, onClick: () => setRevise(null) }, "取消"),
                            ),
                          )
                        : null,
                      React.createElement(
                        "div",
                        { style: styles.actions },
                        React.createElement("button", { style: styles.button, onClick: startRevise }, "修订"),
                        React.createElement("button", { style: { ...styles.button, ...styles.danger }, onClick: removeItem }, "删除"),
                        React.createElement("button", { style: styles.button, onClick: () => { setDetail(null); setRevise(null); } }, "收起"),
                      ),
                    ),
            )
          : null,
        ),
        manual
          ? React.createElement(
              "div",
              { style: styles.overlay, onClick: () => setManual(false) },
              React.createElement(
                "div",
                { style: styles.modal, onClick: (event) => event.stopPropagation() },
                React.createElement("h2", { style: styles.detailTitle }, "命令手册"),
                React.createElement(
                  "p",
                  { style: styles.small },
                  "高级用法。日常只需要点按钮；命令是可选的快捷方式。",
                ),
                React.createElement("pre", { style: styles.pre }, MANUAL),
                React.createElement(
                  "button",
                  { style: { ...styles.button, marginTop: "14px" }, onClick: () => setManual(false) },
                  "关闭",
                ),
              ),
            )
          : null,
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
      ensureScrollbarStyles();
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
