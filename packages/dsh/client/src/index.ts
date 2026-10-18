// @ts-nocheck
/**
 * Agent Memory — DSH client source (V2 P3.5).
 *
 * Bundled by scripts/build.mjs into client/client.js in the loader's factory
 * form. Types are deferred: this file keeps the P1/P2 behaviour stable while
 * the build moves from hand-written output to a real bundle.
 */
import * as React from "react";
import { ensureStyles, initialTheme, persistTheme, type Theme } from "./styles";
import { AmBadge, AmButton, AmSkeleton } from "./components";

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
        color: "var(--am-text, #111827)",
        display: "flex",
        flexDirection: "column",
      },
      header: { display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "4px" },
      h1: { fontSize: "22px", fontWeight: 600, margin: 0 },
      meta: { color: "var(--am-text-secondary, #6b7280)", fontSize: "13px" },
      toolbar: { display: "flex", gap: "8px", alignItems: "center", margin: "18px 0 22px" },
      input: {
        flex: "1 1 320px",
        padding: "8px 12px",
        borderRadius: "8px",
        border: "1px solid var(--am-border, #e5e7eb)",
        background: "var(--am-surface, #fff)",
        fontSize: "13px",
      },
      button: {
        padding: "7px 12px",
        borderRadius: "8px",
        border: "1px solid var(--am-border, #e5e7eb)",
        background: "transparent",
        color: "var(--am-text, #111827)",
        cursor: "pointer",
        fontSize: "13px",
        whiteSpace: "nowrap",
      },
      buttonPrimary: {
        padding: "7px 12px",
        borderRadius: "8px",
        border: "1px solid var(--am-accent, #3b5bdb)",
        background: "var(--am-accent, #3b5bdb)",
        color: "#fff",
        cursor: "pointer",
        fontSize: "13px",
        whiteSpace: "nowrap",
      },
      small: { fontSize: "12px", color: "var(--am-text-secondary, #6b7280)" },
      danger: { color: "#b91c1c", borderColor: "#fecaca" },
      textarea: {
        width: "100%",
        minHeight: "140px",
        padding: "10px 12px",
        borderRadius: "8px",
        border: "1px solid var(--am-border, #e5e7eb)",
        background: "var(--am-surface, #fff)",
        fontSize: "13px",
        lineHeight: 1.6,
        fontFamily: "inherit",
        boxSizing: "border-box",
        resize: "vertical",
      },
      card: {
        padding: "14px 16px",
        border: "1px solid var(--am-border, #e5e7eb)",
        borderRadius: "10px",
        background: "var(--am-surface, #fff)",
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
      count: { color: "var(--am-text-secondary, #6b7280)", fontWeight: 400 },
      list: { display: "flex", flexDirection: "column", gap: "6px" },
      row: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 12px",
        borderRadius: "10px",
        border: "1px solid transparent",
        background: "var(--am-surface, #fff)",
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
      date: { fontSize: "12px", color: "var(--am-text-secondary, #6b7280)", whiteSpace: "nowrap" },
      empty: {
        padding: "40px 16px",
        textAlign: "center",
        color: "var(--am-text-secondary, #6b7280)",
        border: "1px dashed var(--am-border, #e5e7eb)",
        borderRadius: "12px",
        fontSize: "13px",
      },
      detail: {
        order: 1,
        marginTop: "20px",
        padding: "20px",
        border: "1px solid var(--am-border, #e5e7eb)",
        borderRadius: "12px",
        background: "var(--am-surface, #fff)",
      },
      detailTitle: { fontSize: "16px", fontWeight: 600, margin: "0 0 8px" },
      body: {
        whiteSpace: "pre-wrap",
        fontSize: "13px",
        lineHeight: 1.7,
        margin: "12px 0 0",
        padding: "12px",
        borderRadius: "8px",
        background: "var(--am-surface-muted, #f9fafb)",
        fontFamily: "inherit",
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
        background: "var(--am-surface, #fff)",
        borderRadius: "14px",
        padding: "22px 24px",
        boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
      },
      pre: {
        margin: "12px 0 0",
        padding: "12px",
        borderRadius: "8px",
        background: "var(--am-surface-muted, #f9fafb)",
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

    function badge(kind, serial) {
      const known = KIND_STYLE[kind] ? kind : "fact";
      return React.createElement(AmBadge, { kind: known }, serial || "—");
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
      const fileInputRef = React.useRef(null);
      const [busy, setBusy] = React.useState(false);
      const [revise, setRevise] = React.useState(null);
      const [expandedProposal, setExpandedProposal] = React.useState(null);
      const [createKind, setCreateKind] = React.useState("fact");
      const [createForm, setCreateForm] = React.useState({ abstract: "", body: "", valid_from: "", signatures: "" });
      const [summary, setSummary] = React.useState(null);
      const [selectedSuggestions, setSelectedSuggestions] = React.useState([]);
      const [soulPath, setSoulPath] = React.useState(null);
      const [theme, setTheme] = React.useState(() => initialTheme());

      React.useEffect(() => {
        persistTheme(theme);
      }, [theme]);

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
        setRevise(null);
        if (rootRef.current) rootRef.current.scrollTo({ top: 0, behavior: "smooth" });
        fetch(`/api/agent-memory/item?id=${encodeURIComponent(id)}`, { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => setDetail({ data }))
          .catch((error) => setDetail({ error: String(error) }));
      };

      const runSearch = () => {
        setDetail(null);
        setRevise(null);
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

      const importFile = (file) => {
        if (!file) return;
        setBusy(true);
        file
          .text()
          .then((text) => postJson("/api/agent-memory/import", JSON.parse(text)))
          .then((report) => {
            const failed = Array.isArray(report.failed) ? report.failed.length : 0;
            setNotice(`导入完成：新增 ${report.imported} 条，重复跳过 ${report.skipped} 条${failed > 0 ? `，失败 ${failed} 条` : ""}`);
            load();
          })
          .catch((error) => setNotice(`导入失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
      };

      const refreshProposals = () =>
        fetch("/api/agent-memory/proposals", { headers: { accept: "application/json" } })
          .then((response) => (response.ok ? response.json() : []))
          .then((data) => setProposals(Array.isArray(data) ? data : []))
          .catch(() => setProposals([]));

      const openProposals = () => {
        setPanel("proposals");
        setNotice("");
        setDetail(null);
        setRevise(null);
        setExpandedProposal(null);
        refreshProposals();
      };

      const openSettings = () => {
        setPanel("settings");
        setNotice("");
        setDetail(null);
        setRevise(null);
        fetch("/api/agent-memory/profile", { headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((data) => setProfileText((data.entries || []).join("\n\n---\n\n")))
          .catch(() => setNotice("读取偏好失败"));
        fetch("/api/agent-memory/rules", { headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((data) => setRulesText(data.text || ""))
          .catch(() => setNotice("读取规则失败"));
        fetch("/api/agent-memory/soul-path", { headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((data) => setSoulPath(data))
          .catch(() => setSoulPath(null));
      };

      const openCreate = (kind) => {
        setPanel("create");
        setCreateKind(kind);
        setCreateForm({ abstract: "", body: "", valid_from: "", signatures: "" });
        setNotice("");
        setDetail(null);
        setRevise(null);
      };

      const saveCreate = () => {
        const abstract = createForm.abstract.trim();
        if (abstract === "") {
          setNotice("请先填写一句摘要。");
          return;
        }
        const payload = { kind: createKind, abstract, body: createForm.body };
        if (createForm.valid_from !== "") payload.valid_from = createForm.valid_from;
        if (createKind === "pitfall") {
          const signatures = createForm.signatures
            .split(/[,，]/)
            .map((signature) => signature.trim())
            .filter((signature) => signature !== "");
          if (signatures.length === 0) {
            setNotice("坑至少需要一条错误特征。");
            return;
          }
          payload.error_signatures = signatures;
        }
        setBusy(true);
        postJson("/api/agent-memory/create", payload)
          .then((result) => {
            setNotice(result.deduplicated ? `已存在：${result.display}` : "已新增。");
            setPanel(null);
            allReload();
          })
          .catch((error) => setNotice(`新增失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
      };

      const openSummary = () => {
        setPanel("summary");
        setSummary(null);
        setSelectedSuggestions([]);
        setDetail(null);
        setRevise(null);
        setNotice("");
        fetch("/api/agent-memory/summarize", { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => setSummary(data))
          .catch((error) => setNotice(`整理失败：${String(error.message || error)}`));
      };

      const toggleSuggestion = (id) => {
        setSelectedSuggestions((current) =>
          current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
        );
      };

      const applySuggestions = () => {
        if (!summary) return;
        const picked = summary.suggestions.filter((suggestion) => selectedSuggestions.includes(suggestion.id));
        if (picked.length === 0) return;
        const current = rulesText || "";
        const maxNumber = current
          .split(/\r?\n/)
          .map((line) => /^(\d+)\./.exec(line))
          .filter(Boolean)
          .reduce((max, match) => Math.max(max, Number(match[1])), 0);
        let next = maxNumber;
        const lines = picked.map((suggestion) => {
          next += 1;
          return `${next}. [模型指引] ${suggestion.text}`;
        });
        setRulesText(current.trim() === "" ? lines.join("\n") : `${current.trimEnd()}\n${lines.join("\n")}`);
        setPanel("settings");
        setNotice("建议已放入规则草稿；点「保存并重新封存」后才生效。");
      };

      const copySoulPath = () => {
        if (!soulPath || !navigator.clipboard) {
          setNotice("无法访问剪贴板，请手动选择路径。");
          return;
        }
        navigator.clipboard
          .writeText(soulPath.path)
          .then(() => setNotice("路径已复制。"))
          .catch(() => setNotice("复制失败，请手动选择路径。"));
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
        if (!window.confirm("彻底删除这条记忆？文件会被移除，journal 只留下删除记录（不含正文）。")) return;
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
            { key: item.id, className: "am-row", onClick: () => openItem(item.id) },
            badge(item.kind, item.serial),
            React.createElement("span", { style: styles.abstract }, item.abstract),
            React.createElement("span", { style: styles.date }, item.valid_from || item.created_at.slice(0, 10)),
          ),
        );

      return React.createElement(
        "div",
        {
          ref: rootRef,
          className: "am-root am-memory-scroll",
          "data-am-theme": theme,
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
          { className: "am-page" },
          React.createElement(
            "div",
            { className: "am-header" },
          React.createElement("h1", { className: "am-title" }, "记忆"),
          metric("共", total),
          metric("待审", pending),
          React.createElement(
            "span",
            { style: { marginLeft: "auto" } },
            React.createElement(
              AmButton,
              {
                variant: "icon",
                title: theme === "dark" ? "切换到浅色" : "切换到深色",
                onClick: () => setTheme(theme === "dark" ? "light" : "dark"),
              },
              theme === "dark" ? "☀" : "☾",
            ),
          ),
        ),
        React.createElement(
          "p",
          { className: "am-subtitle" },
          data && data.modules && data.modules.some((module) => !module.ok)
            ? `部分模块不可用：${data.modules
                .filter((module) => !module.ok)
                .map((module) => module.name)
                .join("、")}`
            : "这里是助手记住的事。点一条查看原文与出处；修订会先弹卡片确认。",
        ),
        React.createElement(
          "div",
          { className: "am-toolbar" },
          React.createElement("input", {
            className: "am-input",
            style: { flex: "1 1 320px" },
            placeholder: "搜索记忆（关键词）",
            value: query,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") runSearch();
            },
          }),
          React.createElement(AmButton, { variant: "primary", onClick: runSearch }, "搜索"),
          React.createElement(AmButton, { variant: "ghost", onClick: () => openCreate("fact") }, "＋ 新增"),
          React.createElement(AmButton, { variant: "ghost", onClick: openSummary }, "整理"),
          React.createElement(AmButton, { variant: "ghost", onClick: openProposals }, `提案 ${data ? data.pending : ""}`.trim()),
          React.createElement(AmButton, { variant: "ghost", onClick: openSettings }, "偏好与规则"),
          React.createElement(AmButton, { variant: "ghost", onClick: () => setManual(true) }, "命令手册"),
          React.createElement(AmButton, { variant: "ghost", onClick: exportNow }, "导出备份"),
          React.createElement("input", {
            ref: fileInputRef,
            type: "file",
            accept: ".json,application/json",
            style: { display: "none" },
            onChange: (event) => {
              importFile(event.target.files ? event.target.files[0] : null);
              event.target.value = "";
            },
          }),
          React.createElement(
            AmButton,
            { variant: "ghost", disabled: busy, onClick: () => fileInputRef.current && fileInputRef.current.click() },
            "导入备份",
          ),
        ),
        notice ? React.createElement("p", { style: styles.notice }, notice) : null,
        panel === "create"
          ? React.createElement(
              "div",
              null,
              React.createElement("h2", { style: styles.groupTitle }, "新增一条记忆"),
              React.createElement(
                "p",
                { style: styles.small },
                "你手写的条目会记为「人工维护」；同内容的已有条目会自动跳过。",
              ),
              React.createElement(
                "select",
                {
                  className: "am-input",
                  style: { marginTop: "12px", width: "180px" },
                  value: createKind,
                  onChange: (event) => setCreateKind(event.target.value),
                },
                React.createElement("option", { value: "fact" }, "事实"),
                React.createElement("option", { value: "pitfall" }, "坑"),
                React.createElement("option", { value: "exp" }, "经验"),
              ),
              React.createElement("input", {
                className: "am-input",
                style: { marginTop: "8px", width: "100%", boxSizing: "border-box" },
                placeholder: "一句话摘要（必填）",
                value: createForm.abstract,
                onChange: (event) => setCreateForm({ ...createForm, abstract: event.target.value }),
              }),
              React.createElement("textarea", {
                className: "am-textarea",
                style: { marginTop: "8px", width: "100%", minHeight: "120px", boxSizing: "border-box" },
                placeholder: "正文（可选）",
                value: createForm.body,
                onChange: (event) => setCreateForm({ ...createForm, body: event.target.value }),
              }),
              React.createElement("input", {
                className: "am-input",
                type: "date",
                style: { marginTop: "8px" },
                value: createForm.valid_from,
                onChange: (event) => setCreateForm({ ...createForm, valid_from: event.target.value }),
              }),
              createKind === "pitfall"
                ? React.createElement("input", {
                    className: "am-input",
                    style: { marginTop: "8px", width: "100%", boxSizing: "border-box" },
                    placeholder: "错误特征，逗号分隔（坑必填）",
                    value: createForm.signatures,
                    onChange: (event) => setCreateForm({ ...createForm, signatures: event.target.value }),
                  })
                : null,
              React.createElement(
                "div",
                { style: { ...styles.actions, marginTop: "14px" } },
                React.createElement(AmButton, { variant: "primary", disabled: busy, onClick: saveCreate }, "保存"),
                React.createElement(AmButton, { variant: "ghost", onClick: () => setPanel(null) }, "取消"),
              ),
            )
          : panel === "summary"
            ? React.createElement(
                "div",
                null,
                React.createElement("h2", { style: styles.groupTitle }, "整理记忆"),
                summary === null
                  ? React.createElement(AmSkeleton, { rows: 3 })
                  : React.createElement(
                      "div",
                      null,
                      React.createElement(
                        "p",
                        { style: styles.small },
                        `共 ${summary.total} 条：事实 ${summary.by_kind.fact} · 坑 ${summary.by_kind.pitfall} · 经验 ${summary.by_kind.exp}`,
                      ),
                      React.createElement(
                        "h3",
                        { style: styles.groupTitle },
                        "建议写入规则（勾选后只是放入草稿）",
                      ),
                      summary.suggestions.map((suggestion) =>
                        React.createElement(
                          "label",
                          {
                            key: suggestion.id,
                            style: { ...styles.card, display: "flex", gap: "10px", cursor: "pointer", marginBottom: "8px" },
                          },
                          React.createElement("input", {
                            type: "checkbox",
                            checked: selectedSuggestions.includes(suggestion.id),
                            onChange: () => toggleSuggestion(suggestion.id),
                            style: { marginTop: "4px" },
                          }),
                          React.createElement(
                            "span",
                            null,
                            React.createElement("span", { style: { fontSize: "13px" } }, suggestion.text),
                            React.createElement(
                              "span",
                              { style: { ...styles.small, display: "block", marginTop: "4px" } },
                              `${suggestion.category} · 置信度 ${suggestion.confidence}${suggestion.basis.length > 0 ? ` · 依据 ${suggestion.basis.join("、")}` : ""}`,
                            ),
                          ),
                        ),
                      ),
                      React.createElement(
                        "div",
                        { style: { ...styles.actions, marginTop: "12px" } },
                        React.createElement(
                          AmButton,
                          {
                            variant: "primary",
                            disabled: selectedSuggestions.length === 0,
                            onClick: applySuggestions,
                          },
                          "加入规则草稿",
                        ),
                        React.createElement(AmButton, { variant: "ghost", onClick: () => setPanel(null) }, "返回"),
                      ),
                      React.createElement(
                        "p",
                        { style: styles.small },
                        "草稿只进入规则编辑器；必须再点「保存并重新封存」才会生效。",
                      ),
                    ),
              )
            : panel === "proposals"
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
                      expandedProposal === proposal.id
                        ? React.createElement(
                            "div",
                            { style: { ...styles.card, marginTop: "10px", background: "var(--am-surface-muted, #f9fafb)" } },
                            proposal.targets.map((target, index) =>
                              React.createElement(
                                "p",
                                { key: `t-${index}`, style: { ...styles.small, margin: "0 0 6px" } },
                                `目标全文：${target.abstract}`,
                              ),
                            ),
                            proposal.replacements.map((replacement, index) =>
                              React.createElement(
                                "div",
                                { key: `r-${index}`, style: { marginTop: "8px" } },
                                React.createElement(
                                  "p",
                                  { style: { ...styles.small, margin: "0 0 4px" } },
                                  `修改后摘要（${KIND_STYLE[replacement.kind] ? KIND_STYLE[replacement.kind].label : replacement.kind}）：${replacement.abstract}`,
                                ),
                                React.createElement("pre", { style: styles.body }, replacement.body || "（正文为空）"),
                              ),
                            ),
                            React.createElement(
                              "p",
                              { style: { ...styles.small, margin: "8px 0 0" } },
                              `理由：${proposal.reason || "（无说明）"}`,
                            ),
                          )
                        : null,
                      React.createElement(
                        "div",
                        { style: styles.actions },
                        React.createElement(
                          "button",
                          {
                            style: styles.button,
                            onClick: () =>
                              setExpandedProposal(expandedProposal === proposal.id ? null : proposal.id),
                          },
                          expandedProposal === proposal.id ? "收起详情" : "查看详情",
                        ),
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
                React.createElement("h2", { style: styles.groupTitle }, "人格（SOUL.md，只读路径）"),
                soulPath === null
                  ? React.createElement("p", { style: styles.small }, "正在读取路径…")
                  : React.createElement(
                      "div",
                      null,
                      React.createElement(
                        "code",
                        {
                          style: {
                            display: "block",
                            padding: "10px 12px",
                            borderRadius: "8px",
                            background: "var(--am-surface-muted, #f1f3f4)",
                            fontFamily: "var(--am-mono, monospace)",
                            fontSize: "12px",
                            wordBreak: "break-all",
                          },
                        },
                        soulPath.path,
                      ),
                      React.createElement(
                        "div",
                        { style: styles.actions },
                        React.createElement(AmButton, { variant: "ghost", onClick: copySoulPath }, "复制路径"),
                      ),
                      React.createElement("p", { style: styles.small }, soulPath.hint),
                    ),
                React.createElement("button", { style: { ...styles.button, marginTop: "12px" }, onClick: () => setPanel(null) }, "返回列表"),
              )
            : null,
        panel !== null
          ? null
          : React.createElement(
              "div",
              { style: { order: 2 } },
              state.loading
                ? React.createElement(AmSkeleton, { rows: 3 })
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
                                      { key: hit.id, className: "am-row", onClick: () => openItem(hit.id) },
                                      badge(hit.kind, hit.serial),
                                      React.createElement("span", { style: styles.abstract }, hit.abstract),
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
                            { style: { ...styles.groupTitle, justifyContent: "space-between" } },
                            React.createElement(
                              "span",
                              null,
                              KIND_STYLE[group.kind] ? KIND_STYLE[group.kind].label : group.label,
                              React.createElement("span", { style: styles.count }, ` · ${group.items.length}`),
                            ),
                            React.createElement(
                              AmButton,
                              {
                                variant: "icon",
                                title: `新增${KIND_STYLE[group.kind] ? KIND_STYLE[group.kind].label : ""}`,
                                onClick: () => openCreate(group.kind),
                              },
                              "＋",
                            ),
                          ),
                          group.items.length === 0
                            ? React.createElement("div", { style: styles.empty }, "这一类还没有记忆。")
                            : React.createElement(
                                "div",
                                null,
                                React.createElement("div", { style: styles.list }, renderRows(group.items.slice(0, 8))),
                                group.items.length > 8
                                  ? React.createElement(
                                      "div",
                                      {
                                        className: "am-memory-scroll",
                                        style: {
                                          ...styles.list,
                                          marginTop: "6px",
                                          maxHeight: "320px",
                                          overflowY: "auto",
                                        },
                                      },
                                      React.createElement(
                                        "p",
                                        { style: { ...styles.small, margin: "0 0 6px" } },
                                        `还有 ${group.items.length - 8} 条，向下滚动查看`,
                                      ),
                                      renderRows(group.items.slice(8)),
                                    )
                                  : null,
                              ),
                        ),
                      ),
            ),
        detail
          ? React.createElement(
              "div",
              { className: "am-card am-detail", style: { order: 1 } },
              detail.loading
                ? React.createElement(AmSkeleton, { rows: 2 })
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
              { className: "am-overlay", onClick: () => setManual(false) },
              React.createElement(
                "div",
                { className: "am-modal", onClick: (event) => event.stopPropagation() },
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
            border: "1px solid var(--am-border, #e5e7eb)",
          },
        },
        "记",
      );
    }

    function apply(ctx) {
      ensureStyles();
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

export { apply, inject };
