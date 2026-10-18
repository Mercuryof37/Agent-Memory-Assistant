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
      field: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "12px" },
      label: { fontSize: "13px", fontWeight: 600 },
      hint: { fontSize: "12px", color: "var(--am-text-secondary, #6b7280)", lineHeight: 1.6 },
      callout: {
        marginTop: "12px",
        padding: "10px 12px",
        borderRadius: "8px",
        background: "var(--am-accent-soft, #e8f0fe)",
        fontSize: "12px",
        lineHeight: 1.7,
      },
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
      "/mem read <库编号>          查看全文（如 F-01）",
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
      const [tree, setTree] = React.useState(null);
      const [treeProject, setTreeProject] = React.useState(null);
      const [focusId, setFocusId] = React.useState(null);
      const [newProjectOpen, setNewProjectOpen] = React.useState(false);
      const [newProjectName, setNewProjectName] = React.useState("");
      const [selectedIds, setSelectedIds] = React.useState([]);
      const [moveTarget, setMoveTarget] = React.useState("");
      const [tagDraft, setTagDraft] = React.useState("");
      const [relationTarget, setRelationTarget] = React.useState("");
      const [relationType, setRelationType] = React.useState("relates_to");

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

      const refreshGraph = () =>
        fetch("/api/agent-memory/graph", { headers: { accept: "application/json" } })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => setTree({ data }))
          .catch((error) => setTree({ error: String(error) }));

      const openTree = () => {
        setPanel("tree");
        setTree({ loading: true });
        setTreeProject(null);
        setFocusId(null);
        setDetail(null);
        refreshGraph();
      };

      React.useEffect(() => {
        if (detail && detail.data) {
          setTagDraft((detail.data.tags || []).join(", "));
          setRelationTarget("");
        }
      }, [detail]);

      React.useEffect(() => {
        if (panel !== "tree") {
          setTreeProject(null);
          setFocusId(null);
          setDetail(null);
          setNewProjectOpen(false);
          setNewProjectName("");
          setSelectedIds([]);
          setMoveTarget("");
        }
      }, [panel]);

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

      const sealSoulNow = () => {
        if (!window.confirm("确认已在外部修改 SOUL.md？将重新计算并封存哈希，下一次启动生效。")) return;
        setBusy(true);
        setNotice("");
        postJson("/api/agent-memory/policy/seal", {})
          .then(() => setNotice("已重新封存。"))
          .catch((error) => setNotice(`封存失败：${String(error.message || error)}`))
          .finally(() => setBusy(false));
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

      const graphData = tree && tree.data ? tree.data : null;
      const graphNodes = graphData ? graphData.nodes : [];
      const graphEdges = graphData ? graphData.edges : [];
      const focusNode = focusId === null ? null : graphNodes.find((node) => node.id === focusId) || null;
      const explicitNeighbors = focusNode
        ? graphEdges
            .filter((edge) => edge.from === focusNode.id || edge.to === focusNode.id)
            .map((edge) => {
              const id = edge.from === focusNode.id ? edge.to : edge.from;
              return { node: graphNodes.find((node) => node.id === id), edge };
            })
            .filter((entry) => entry.node)
        : [];
      const explicitIds = new Set(explicitNeighbors.map((entry) => entry.node.id));
      const suggestedNeighbors = focusNode
        ? graphNodes
            .filter((node) => {
              if (node.id === focusNode.id || explicitIds.has(node.id)) return false;
              if (node.project !== focusNode.project) return false;
              return (node.tags || []).some((tag) => (focusNode.tags || []).includes(tag));
            })
            .map((node) => ({ node, edge: { type: "same_topic", from: focusNode.id, to: node.id } }))
        : [];
      const focusNeighbors = [...explicitNeighbors, ...suggestedNeighbors].slice(0, 8);

      const renderTreeCards = () => {
        if (!graphData) return null;
        return React.createElement(
          "div",
          { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px", marginTop: "6px" } },
          graphData.projects.map((project) =>
            React.createElement(
              "button",
              {
                key: project.name,
                className: "am-row",
                style: { display: "block", width: "100%", textAlign: "left", padding: "14px", cursor: "pointer" },
                onClick: () => {
                  setTreeProject(project.name);
                  setFocusId(null);
                  setDetail(null);
                  setSelectedIds([]);
                  setMoveTarget("");
                },
              },
              React.createElement("div", { style: { fontWeight: 600, marginBottom: "4px" } }, project.name),
              React.createElement("div", { style: styles.small }, `${project.count} 条记忆`),
              graphData.conflicts && graphData.conflicts.some((conflict) => conflict.project === project.name)
                ? React.createElement("div", { style: { ...styles.small, color: "var(--am-warn)" } }, `相似提示 ${graphData.conflicts.filter((conflict) => conflict.project === project.name).length}`)
                : null,
              React.createElement(
                "div",
                { style: { ...styles.small, color: "var(--am-text-tertiary)", marginTop: "2px" } },
                project.last_updated ? `最近更新 ${project.last_updated}` : "还没有记忆",
              ),
              project.name === "未归类"
                ? null
                : React.createElement(
                    "span",
                    {
                      style: { ...styles.small, color: "var(--am-danger)", marginTop: "6px", display: "inline-block" },
                      onClick: (event) => {
                        event.stopPropagation();
                        if (!window.confirm(`删除项目「${project.name}」？里面的记忆会回到「未归类」，不会被删除。`)) return;
                        fetch(`/api/agent-memory/projects?name=${encodeURIComponent(project.name)}`, { method: "DELETE" })
                          .then(async (response) => {
                            const data = await response.json().catch(() => ({}));
                            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
                            openTree();
                          })
                          .catch((error) => setNotice(`删除项目失败：${String(error.message || error)}`));
                      },
                    },
                    "删除项目",
                  ),
            ),
          ),
        );
      };

      const renderFocus = () => {
        if (focusNode === null) {
          return React.createElement(
            "div",
            { style: { ...styles.small, padding: "18px" } },
            "点左侧一条记忆，查看它的局部关系。",
          );
        }
        if (focusNeighbors.length === 0) {
          return React.createElement(
            "div",
            { style: { display: "grid", gap: "10px" } },
            React.createElement("h3", { style: { margin: 0, fontSize: "15px" } }, `${focusNode.serial || "—"} ${focusNode.display}`),
            React.createElement(
              "div",
              { style: { ...styles.small, padding: "16px", background: "var(--am-surface-muted)", borderRadius: "12px" } },
              "暂无显式关系；同项目、同标签的条目也没有。给这条记忆加标签或关系后，这里会出现局部图。",
            ),
          );
        }
        const width = 460;
        const height = 280;
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = 92;
        const around = focusNeighbors.slice(0, 8).map((entry, index) => {
          const angle = (Math.PI * 2 * index) / Math.max(1, Math.min(8, focusNeighbors.length));
          return { ...entry, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
        });
        const label = (node) => (node.display ? node.display.replace(/^[FPE]-\d+\s*/, "") : node.id).slice(0, 16);
        return React.createElement(
          "div",
          { style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "12px" } },
          React.createElement(
            "svg",
            { viewBox: `0 0 ${width} ${height}`, style: { width: "100%", height: "280px", background: "var(--am-surface-muted)", borderRadius: "12px" } },
            ...around.map((entry) =>
              React.createElement("line", {
                key: `line-${entry.node.id}`,
                x1: centerX,
                y1: centerY,
                x2: entry.x,
                y2: entry.y,
                stroke: entry.edge.type === "same_topic" ? "var(--am-border)" : "var(--am-border-strong)",
                strokeWidth: entry.edge.type === "same_topic" ? 1 : 1.2,
                strokeDasharray: entry.edge.type === "same_topic" ? "4 3" : undefined,
              }),
            ),
            React.createElement("circle", { cx: centerX, cy: centerY, r: 34, fill: "var(--am-accent-soft)", stroke: "var(--am-accent)" }),
            React.createElement(
              "text",
              { x: centerX, y: centerY + 4, textAnchor: "middle", fontSize: 10, fill: "var(--am-text)" },
              focusNode.serial || "SEL",
            ),
            ...around.flatMap((entry) => [
              React.createElement("circle", {
                key: `node-${entry.node.id}`,
                cx: entry.x,
                cy: entry.y,
                r: 20,
                fill: "var(--am-surface)",
                stroke: `var(--am-${entry.node.kind})`,
                strokeWidth: 2,
                style: { cursor: "pointer" },
                onClick: () => {
                  setFocusId(entry.node.id);
                  openItem(entry.node.id);
                },
              }),
              React.createElement(
                "text",
                { key: `text-${entry.node.id}`, x: entry.x, y: entry.y + 4, textAnchor: "middle", fontSize: 8, fill: "var(--am-text-secondary)" },
                label(entry.node),
              ),
            ]),
          ),
        );
      };

      const renderTreePanel = () => {
        if (!tree || tree.loading) return React.createElement("div", { style: styles.small }, "正在加载项目…");
        if (tree.error) return React.createElement("div", { style: styles.small }, `加载失败：${tree.error}`);
        if (treeProject === null) {
          return React.createElement(
            "div",
            null,
            React.createElement("h2", { style: styles.groupTitle }, "项目"),
            React.createElement("p", { style: styles.small }, "按项目查看记忆；点一个项目进入工作树。"),
            React.createElement(
              "div",
              { style: { display: "flex", gap: "8px", alignItems: "center", margin: "8px 0 12px", flexWrap: "wrap" } },
              newProjectOpen
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement("input", {
                      className: "am-input",
                      style: { width: "240px" },
                      placeholder: "新项目名称（例如 Agent Memory）",
                      autoFocus: true,
                      value: newProjectName,
                      onChange: (event) => setNewProjectName(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === "Enter") {
                          const name = newProjectName.trim();
                          if (name === "") return;
                          postJson("/api/agent-memory/projects", { name })
                            .then(() => {
                              setNewProjectOpen(false);
                              setNewProjectName("");
                              openTree();
                            })
                            .catch((error) => setNotice(`新建项目失败：${String(error.message || error)}`));
                        }
                      },
                    }),
                    React.createElement(AmButton, {
                      variant: "primary",
                      onClick: () => {
                        const name = newProjectName.trim();
                        if (name === "") return;
                        postJson("/api/agent-memory/projects", { name })
                          .then(() => {
                            setNewProjectOpen(false);
                            setNewProjectName("");
                            openTree();
                          })
                          .catch((error) => setNotice(`新建项目失败：${String(error.message || error)}`));
                      },
                    }, "创建"),
                    React.createElement(AmButton, { variant: "ghost", onClick: () => { setNewProjectOpen(false); setNewProjectName(""); } }, "取消"),
                  )
                : React.createElement(AmButton, { variant: "ghost", onClick: () => setNewProjectOpen(true) }, "＋ 新建项目"),
            ),
            renderTreeCards(),
          );
        }
        const docs = graphNodes.filter((node) => node.project === treeProject);
        const detailCard = focusNode && detail && detail.data
          ? (() => {
              const current = detail.data;
              const relations = current.relations || [];
              const candidates = graphNodes.filter((node) => node.id !== current.id && node.project === treeProject);
              const saveTags = () => {
                const tags = tagDraft.split(",").map((tag) => tag.trim()).filter((tag) => tag !== "");
                postJson("/api/agent-memory/meta", { id: current.id, tags })
                  .then(() => {
                    refreshGraph();
                    openItem(current.id);
                  })
                  .catch((error) => setNotice(`保存标签失败：${String(error.message || error)}`));
              };
              const saveRelations = (next) => {
                postJson("/api/agent-memory/meta", { id: current.id, relations: next })
                  .then(() => {
                    refreshGraph();
                    openItem(current.id);
                  })
                  .catch((error) => setNotice(`保存关系失败：${String(error.message || error)}`));
              };
              return React.createElement(
                "div",
                { style: { border: "1px solid var(--am-border)", background: "var(--am-surface)", borderRadius: "12px", padding: "18px", marginBottom: "14px" } },
                React.createElement("h2", { style: { margin: 0, fontSize: "18px" } }, current.abstract),
                React.createElement(
                  "div",
                  { style: { display: "grid", gap: "10px", borderTop: "1px solid var(--am-border)", paddingTop: "12px" } },
                  React.createElement(
                    "div",
                    { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                    React.createElement("span", { style: { ...styles.small, fontWeight: 600 } }, "标签"),
                    React.createElement("input", {
                      className: "am-input",
                      style: { width: "260px" },
                      placeholder: "逗号分隔，例如 v4, ui, release",
                      value: tagDraft,
                      onChange: (event) => setTagDraft(event.target.value),
                      onKeyDown: (event) => { if (event.key === "Enter") saveTags(); },
                    }),
                    React.createElement(AmButton, { variant: "ghost", onClick: saveTags }, "保存标签"),
                    React.createElement("span", { style: styles.small }, "最多 8 个，每个 ≤32 字符"),
                  ),
                  React.createElement(
                    "div",
                    { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                    React.createElement("span", { style: { ...styles.small, fontWeight: 600 } }, "关系"),
                    ...relations.map((relation) =>
                      React.createElement(
                        "span",
                        { key: `${relation.type}:${relation.target}`, style: { ...styles.small, background: "var(--am-surface-muted)", padding: "2px 7px", borderRadius: "999px" } },
                        `${relation.type === "relates_to" ? "相关" : "来源"} → ${(graphNodes.find((node) => node.id === relation.target) || { display: relation.target }).display}`,
                        " ",
                        React.createElement("span", {
                          style: { cursor: "pointer", color: "var(--am-danger)" },
                          onClick: () => saveRelations(relations.filter((entry) => entry.target !== relation.target || entry.type !== relation.type)),
                        }, "×"),
                      ),
                    ),
                    relations.length === 0 ? React.createElement("span", { style: styles.small }, "暂无关系，可在下方添加") : null,
                  ),
                  React.createElement(
                    "div",
                    { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                    React.createElement("select", {
                      className: "am-input",
                      style: { width: "120px" },
                      value: relationType,
                      onChange: (event) => setRelationType(event.target.value),
                    },
                      React.createElement("option", { value: "relates_to" }, "相关"),
                      React.createElement("option", { value: "derived_from" }, "来源"),
                    ),
                    React.createElement("select", {
                      className: "am-input",
                      style: { width: "240px" },
                      value: relationTarget,
                      onChange: (event) => setRelationTarget(event.target.value),
                    },
                      React.createElement("option", { value: "" }, "选择目标记忆…"),
                      ...candidates.map((node) => React.createElement("option", { key: node.id, value: node.id }, node.display)),
                    ),
                    React.createElement(AmButton, {
                      variant: "ghost",
                      disabled: relationTarget === "",
                      onClick: () => saveRelations([...relations, { type: relationType, target: relationTarget }]),
                    }, "添加关系"),
                    React.createElement("span", { style: styles.small }, "关系只连接同项目记忆；用于工作树，不改变记忆内容"),
                  ),
                ),
              );
            })()
          : null;
        return React.createElement(
          "div",
          null,
          detailCard,
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px", flexWrap: "wrap" } },
            React.createElement(AmButton, { variant: "ghost", onClick: () => { setTreeProject(null); setFocusId(null); setDetail(null); setSelectedIds([]); } }, "← 全部项目"),
            React.createElement("h2", { style: { ...styles.groupTitle, margin: 0 } }, treeProject),
            React.createElement("span", { style: styles.small }, `${docs.length} 条`),
            React.createElement("span", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" } },
              React.createElement("label", { style: styles.small },
                React.createElement("input", {
                  type: "checkbox",
                  checked: docs.length > 0 && selectedIds.length === docs.length,
                  onChange: (event) => setSelectedIds(event.target.checked ? docs.map((node) => node.id) : []),
                }),
                " 全选",
              ),
              React.createElement("span", { style: styles.small }, `已选 ${selectedIds.length}`),
              React.createElement("select", {
                className: "am-input",
                style: { width: "150px" },
                value: moveTarget,
                onChange: (event) => setMoveTarget(event.target.value),
              },
                React.createElement("option", { value: "" }, "移动到…"),
                React.createElement("option", { value: "__none__" }, "未归类"),
                ...graphData.projects.filter((project) => project.name !== treeProject).map((project) =>
                  React.createElement("option", { key: project.name, value: project.name }, project.name),
                ),
              ),
              React.createElement(AmButton, {
                variant: "primary",
                disabled: selectedIds.length === 0 || moveTarget === "",
                onClick: () => {
                  const target = moveTarget === "__none__" ? null : moveTarget;
                  postJson("/api/agent-memory/projects/move", { ids: selectedIds, project: target })
                    .then(() => {
                      setSelectedIds([]);
                      setMoveTarget("");
                      openTree();
                    })
                    .catch((error) => setNotice(`移动失败：${String(error.message || error)}`));
                },
              }, "移动"),
            ),
          ),
          React.createElement(
            "div",
            { style: { display: "grid", gridTemplateColumns: "minmax(220px, 320px) minmax(0, 1fr)", gap: "18px", alignItems: "start" } },
            React.createElement(
              "div",
              { className: "am-tree-panel" },
              ...["fact", "pitfall", "exp"].map((kind) => {
                const rows = docs.filter((node) => node.kind === kind);
                if (rows.length === 0) return null;
                return React.createElement(
                  "div",
                  { key: kind, className: "am-tree-group" },
                  React.createElement("div", { className: "am-tree-group-title" },
                    React.createElement("span", null, KIND_STYLE[kind] ? KIND_STYLE[kind].label : kind),
                    React.createElement("span", null, String(rows.length)),
                  ),
                  ...rows.map((node) =>
                    React.createElement(
                      "div",
                      { key: node.id, className: `am-tree-row${focusId === node.id ? " is-selected" : ""}` },
                      React.createElement("input", {
                        type: "checkbox",
                        checked: selectedIds.includes(node.id),
                        onChange: (event) =>
                          setSelectedIds((current) =>
                            event.target.checked ? [...current, node.id] : current.filter((id) => id !== node.id),
                          ),
                      }),
                      React.createElement(
                        "button",
                        {
                          className: "am-tree-link",
                          onClick: () => {
                            setFocusId(node.id);
                            openItem(node.id);
                          },
                        },
                        React.createElement("div", { className: "am-tree-title" }, node.display),
                        React.createElement("div", { className: "am-tree-meta" }, `${node.valid_from}${node.tags.length ? ` · ${node.tags.slice(0, 2).join(" ")}` : ""}`),
                      ),
                    ),
                  ),
                );
              }),
            ),
            renderFocus(),
          ),
        );
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
            : "这里是助手记住的事。点一条查看原文；修订会先弹卡片确认。",
        ),
        React.createElement(
          "div",
          { className: "am-toolbar" },
          React.createElement(AmButton, {
            variant: "ghost",
            onClick: panel === "tree" ? () => { setPanel(null); setDetail(null); setFocusId(null); } : openTree,
          }, panel === "tree" ? "← 列表" : "项目"),
          React.createElement(
            "div",
            { className: "am-toolbar-search" },
            React.createElement("input", {
              className: "am-input",
              placeholder: "搜索记忆（关键词）",
              value: query,
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") runSearch();
              },
            }),
            React.createElement(AmButton, { variant: "primary", onClick: runSearch }, "搜索"),
          ),
          React.createElement(
            "div",
            { className: "am-toolbar-actions" },
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
        ),
        notice ? React.createElement("p", { style: styles.notice }, notice) : null,
        panel === "tree"
          ? renderTreePanel()
          : panel === "create"
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
                "div",
                { style: styles.field },
                React.createElement("label", { style: styles.label }, "类型"),
                React.createElement(
                  "select",
                  {
                    className: "am-input",
                    style: { width: "180px" },
                    value: createKind,
                    onChange: (event) => setCreateKind(event.target.value),
                  },
                  React.createElement("option", { value: "fact" }, "事实"),
                  React.createElement("option", { value: "pitfall" }, "坑"),
                  React.createElement("option", { value: "exp" }, "经验"),
                ),
              ),
              React.createElement(
                "div",
                { style: styles.field },
                React.createElement("label", { style: styles.label }, "摘要（必填）"),
                React.createElement(
                  "span",
                  { style: styles.hint },
                  "一句话说清这是什么；列表和提案里显示的就是它。",
                ),
                React.createElement("input", {
                  className: "am-input",
                  style: { width: "100%", boxSizing: "border-box" },
                  placeholder:
                    createKind === "pitfall"
                      ? "例：Windows 沙箱里 git push 报 signal pipe"
                      : "例：部署前先迁移数据库",
                  value: createForm.abstract,
                  onChange: (event) => setCreateForm({ ...createForm, abstract: event.target.value }),
                }),
              ),
              React.createElement(
                "div",
                { style: styles.field },
                React.createElement("label", { style: styles.label }, "正文（可选）"),
                React.createElement(
                  "span",
                  { style: styles.hint },
                  "触发条件、看到的现象、最后怎么处理；可以直接粘贴报错原文。",
                ),
                React.createElement("textarea", {
                  className: "am-textarea",
                  style: { width: "100%", minHeight: "120px", boxSizing: "border-box" },
                  placeholder:
                    createKind === "pitfall"
                      ? "例：在 oh-my-zsh 的 Windows 环境执行 git push 时报错；改用 PowerShell 7 后正常。"
                      : "补充背景、步骤或结论。",
                  value: createForm.body,
                  onChange: (event) => setCreateForm({ ...createForm, body: event.target.value }),
                }),
              ),
              React.createElement(
                "div",
                { style: styles.field },
                React.createElement("label", { style: styles.label }, "日期"),
                React.createElement("span", { style: styles.hint }, "从哪天开始适用；留空则用今天。"),
                React.createElement("input", {
                  className: "am-input",
                  type: "date",
                  style: { width: "180px" },
                  value: createForm.valid_from,
                  onChange: (event) => setCreateForm({ ...createForm, valid_from: event.target.value }),
                }),
              ),
              createKind === "pitfall"
                ? React.createElement(
                    "div",
                    null,
                    React.createElement(
                      "div",
                      { style: styles.callout },
                      "坑怎么填：摘要写「踩了什么坑」，正文写「怎么触发、怎么解决」，错误特征写「报错里固定不变的片段」——以后检索和匹配靠它。",
                    ),
                    React.createElement(
                      "div",
                      { style: styles.field },
                      React.createElement("label", { style: styles.label }, "错误特征（1–3 条，必填）"),
                      React.createElement(
                        "span",
                        { style: styles.hint },
                        "用逗号分隔；按字面匹配，不写正则。例：ECONNREFUSED 5432、Win32 error 5。",
                      ),
                      React.createElement("input", {
                        className: "am-input",
                        style: { width: "100%", boxSizing: "border-box" },
                        placeholder: "ECONNREFUSED 5432, Win32 error 5",
                        value: createForm.signatures,
                        onChange: (event) => setCreateForm({ ...createForm, signatures: event.target.value }),
                      }),
                    ),
                  )
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
                        `${proposal.op === "delete" ? "删除" : proposal.op === "create" ? "新增" : "修订"} · ${
                          proposal.targets.length === 0
                            ? "一条新记忆"
                            : proposal.targets.map((target) => target.display || target.abstract).join("、")
                        }`,
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
                        React.createElement(
                          AmButton,
                          { variant: "primary", disabled: busy, onClick: sealSoulNow },
                          "一键封存",
                        ),
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
        "svg",
        {
          width: 18,
          height: 18,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
          style: { display: "block" },
        },
        React.createElement("path", { d: "M6 4.5h12a1 1 0 0 1 1 1V19.5l-7-3.5-7 3.5V5.5a1 1 0 0 1 1-1Z" }),
        React.createElement("path", { d: "M9 8.5h6" }),
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
