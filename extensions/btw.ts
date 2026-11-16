/**
 * btw — a side-question channel for pi.
 *
 * /btw <q>        ask in the "ctx" thread: seeded with a snapshot of the main session context
 * /btw:t <q>      ask in the "tangent" thread: no main context, pure side talk
 * /btw:save [t]   re-send a thread to the model with a configurable system prompt,
 *                 append the organized note to the configured document
 * /btw:new [t]    clear threads (default: both)
 *
 * Every completed Q&A is auto-appended (raw) to savePath. /btw:save appends an
 * organized section. Threads survive /reload via custom session entries.
 *
 * Config: ~/.pi/agent/btw.json (see README.md). Env overrides: BTW_CONFIG, BTW_SAVE_PATH.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------- types ----------

type BtwMode = "ctx" | "t";

interface Turn {
	q: string;
	a: string;
	ts: number;
}

interface Thread {
	mode: BtwMode;
	turns: Turn[];
	baseCtx?: string; // main-session snapshot (ctx mode, captured at first question)
}

interface BtwConfig {
	model?: string;
	thinkingLevel?: string;
	systemPrompt?: string;
	contextMessages?: number;
	contextBudget?: number;
	savePath?: string;
	autoSave?: boolean;
	saveModel?: string;
	saveThinkingLevel?: string;
	saveSystemPrompt?: string;
}

interface State {
	cfg: BtwConfig;
	threads: Record<BtwMode, Thread>;
	lastMode: BtwMode;
	busy: boolean;
}

const DEFAULT_SAVE_SYSTEM_PROMPT =
	"把这段 btw 侧问问答记录整理成一份结构化 Markdown 笔记：保留结论、代码块与关键细节，去除寒暄与重复；只输出笔记本体，不要额外评论。";

const SIDE_SYSTEM_PROMPT =
	"You are 'btw', a side-channel assistant inside a coding agent session. " +
	"Answer the user's side questions directly and concisely, in the user's language. " +
	"You have no tools; reason from the provided context and the side-thread history.";

// ---------- helpers ----------

function expandPath(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

function configPath(): string {
	const env = process.env.BTW_CONFIG;
	if (env) return expandPath(env);
	return join(homedir(), CONFIG_DIR_NAME, "btw.json");
}

function loadConfig(): BtwConfig {
	const p = configPath();
	try {
		if (existsSync(p)) {
			const raw = JSON.parse(readFileSync(p, "utf8")) as BtwConfig;
			return raw && typeof raw === "object" ? raw : {};
		}
	} catch {
		// malformed config: fall back to defaults
	}
	return {};
}

function savePath(cfg: BtwConfig): string {
	return expandPath(process.env.BTW_SAVE_PATH || cfg.savePath || "~/btw-notes.md");
}

function fmtTs(ts: number): string {
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c: any) => (c && c.type === "text" && typeof c.text === "string" ? c.text : ""))
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function truncateMiddle(s: string, max: number): string {
	if (s.length <= max) return s;
	const head = Math.floor(max * 0.6);
	const tail = max - head;
	return `${s.slice(0, head)}\n[…中段略去 ${s.length - max} 字符…]\n${s.slice(-tail)}`;
}

function resolveModel(ctx: ExtensionContext, spec?: string): any {
	if (!spec) return ctx.model ?? undefined;
	const i = spec.indexOf("/");
	if (i > 0) {
		const m = ctx.modelRegistry.find(spec.slice(0, i), spec.slice(i + 1));
		if (m) return m;
	}
	const all = ctx.modelRegistry.getAvailable() ?? [];
	return all.find((m: any) => m.id === spec || `${m.provider}/${m.id}` === spec);
}

function snapshotMainContext(ctx: ExtensionContext, cfg: BtwConfig): string {
	const keep = cfg.contextMessages ?? 6;
	const budget = cfg.contextBudget ?? 12000;
	const lines: string[] = [];
	let branch: any[] = [];
	try {
		branch = ctx.sessionManager.buildContextEntries() as any[];
	} catch {
		branch = [];
	}
	for (const e of branch) {
		if (e?.type !== "message" || !e.message) continue;
		const role = e.message.role;
		if (role !== "user" && role !== "assistant") continue;
		const t = textOf(e.message.content).trim();
		if (!t) continue;
		lines.push(`[${role}] ${t}`);
	}
	return truncateMiddle(lines.slice(-keep).join("\n\n"), budget);
}

function renderThreadPrompt(thread: Thread, question: string): string {
	const parts: string[] = [];
	if (thread.mode === "ctx" && thread.baseCtx) {
		parts.push(`<main-session-context>\n${thread.baseCtx}\n</main-session-context>`);
	}
	if (thread.turns.length > 0) {
		const hist = thread.turns
			.map((t, i) => `Q${i + 1}: ${t.q}\nA${i + 1}: ${t.a}`)
			.join("\n\n");
		parts.push(`<side-thread-history>\n${hist}\n</side-thread-history>`);
	}
	parts.push(question);
	return parts.join("\n\n");
}

function appendNote(cfg: BtwConfig, body: string): string {
	const p = savePath(cfg);
	const dir = dirname(p);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	appendFileSync(p, body.endsWith("\n") ? body : `${body}\n`);
	return p;
}

function updateWidget(ctx: ExtensionContext, st: State): void {
	if (!ctx.hasUI) return;
	const c = st.threads.ctx.turns.length;
	const t = st.threads.t.turns.length;
	const m = st.cfg.model || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "?");
	ctx.ui.setWidget("btw", [`btw ▸ ctx:${c} t:${t} · ${m} · /btw <q> /btw:t <q> /btw:save`]);
}

// ---------- streaming overlay (TUI) ----------

function wrapLine(line: string, width: number): string[] {
	if (width <= 4) return [line];
	const out: string[] = [];
	let cur = "";
	for (const word of line.split(/\s+/)) {
		const candidate = cur ? `${cur} ${word}` : word;
		if (candidate.length <= width) {
			cur = candidate;
		} else {
			if (cur) out.push(cur);
			while (word.length > width) {
				out.push(word.slice(0, width));
				word = word.slice(width);
			}
			cur = word;
		}
	}
	if (cur || out.length === 0) out.push(cur);
	return out;
}

async function runSideCall(
	ctx: ExtensionContext,
	st: State,
	modelSpec: string | undefined,
	thinking: string | undefined,
	systemPrompt: string,
	prompt: string,
	progress?: (text: string) => void,
): Promise<{ answer: string; aborted: boolean; error?: string }> {
	const model = resolveModel(ctx, modelSpec);
	if (!model) return { answer: "", aborted: false, error: `btw: model not found: ${modelSpec || "(current)"}` };
	const controller = new AbortController();
	let latest = "";
	const context = { systemPrompt, messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] };
	const options: Record<string, unknown> = { signal: controller.signal };
	if (thinking) options.reasoningEffort = thinking;

	// TUI: overlay that streams; otherwise headless await.
	if (ctx.mode === "tui") {
		let finished = false;
		const view = await ctx.ui.custom<string | null>((tui: any, theme: any, kb: any, done: (v: string | null) => void) => {
			const component = {
				render(width: number): string[] {
					const lines: string[] = [];
					lines.push(theme.fg("accent", "─ btw ─ Esc 中止 ─"));
					const body = latest || "…";
					for (const raw of body.split("\n")) for (const w of wrapLine(raw, Math.max(8, width - 2))) lines.push(theme.fg("accent", ` ${w}`));
					const maxRows = Math.max(6, (tui?.terminalRows ?? 30) - 6);
					return lines.slice(-maxRows);
				},
				handleInput(data: string): void {
					if (data === "\x1b" || data === "\x03") {
						if (!finished) {
							finished = true;
							controller.abort();
							done(null);
						}
					}
				},
				invalidate() {},
			};
			(async () => {
				try {
					const stream = ctx.modelRegistry.streamSimple(model, context, options);
					for await (const ev: any of stream) {
						if (ev?.message) {
							const t = textOf(ev.message.content);
							if (t) {
								latest = t;
								progress?.(t);
								tui?.requestRender?.();
							}
						}
					}
					const final: any = await stream.result();
					const answer = textOf(final?.content) || latest;
					if (!finished) {
						finished = true;
						done(answer || null);
					}
				} catch (err: any) {
					if (!finished) {
						finished = true;
						done(controller.signal.aborted ? null : `__error__${String(err?.message || err)}`);
					}
				}
			})();
			return component;
		});
		if (view === null) return { answer: "", aborted: true };
		if (typeof view === "string" && view.startsWith("__error__")) return { answer: "", aborted: false, error: view.slice(9) };
		return { answer: view ?? "", aborted: false };
	}

	// headless
	try {
		const stream = ctx.modelRegistry.streamSimple(model, context, options);
		for await (const ev: any of stream) {
			if (ev?.message) {
				const t = textOf(ev.message.content);
				if (t) {
					latest = t;
					progress?.(t);
				}
			}
		}
		const final: any = await stream.result();
		return { answer: textOf(final?.content) || latest, aborted: controller.signal.aborted };
	} catch (err: any) {
		return { answer: "", aborted: controller.signal.aborted, error: String(err?.message || err) };
	}
}

// ---------- thread ask ----------

async function ask(pi: ExtensionAPI, ctx: ExtensionContext, st: State, mode: BtwMode, question: string): Promise<void> {
	if (st.busy) {
		ctx.ui.notify("btw: 上一条侧问还在跑，稍等或 Esc 中止", "warning");
		return;
	}
	st.busy = true;
	st.lastMode = mode;
	const thread = st.threads[mode];
	// (re)seed ctx snapshot at thread start
	if (mode === "ctx" && thread.turns.length === 0) {
		thread.baseCtx = snapshotMainContext(ctx, st.cfg);
	}
	try {
		if (ctx.hasUI) ctx.ui.setStatus("btw", "btw: thinking…");
		const prompt = renderThreadPrompt(thread, question);
		const { answer, aborted, error } = await runSideCall(
			ctx,
			st,
			st.cfg.model,
			st.cfg.thinkingLevel,
			st.cfg.systemPrompt ? `${SIDE_SYSTEM_PROMPT}\n\n${st.cfg.systemPrompt}` : SIDE_SYSTEM_PROMPT,
			prompt,
		);
		if (ctx.hasUI) ctx.ui.setStatus("btw", undefined);
		if (aborted) {
			ctx.ui.notify("btw: 已中止（线程未记录本次提问）", "warning");
			return;
		}
		if (error) {
			ctx.ui.notify(`btw: ${error}`, "error");
			return;
		}
		if (!answer.trim()) {
			ctx.ui.notify("btw: 空回答", "warning");
			return;
		}
		thread.turns.push({ q: question, a: answer, ts: Date.now() });
		const turn = thread.turns[thread.turns.length - 1];
		pi.appendEntry("btw:turn", { mode, q: turn.q, a: turn.a, ts: turn.ts, baseCtx: thread.turns.length === 1 ? thread.baseCtx : undefined });
		if (st.cfg.autoSave !== false) {
			const p = appendNote(st.cfg, `\n## ${fmtTs(turn.ts)} · btw[${mode}] · ${turn.q}\n\n${turn.a}\n`);
			if (ctx.mode === "tui") ctx.ui.notify(`btw: 已存 ${p}`, "info");
		}
		updateWidget(ctx, st);
	} finally {
		st.busy = false;
	}
}

// ---------- commands ----------

function parseModeArg(args: string, fallback: BtwMode, st: State): BtwMode {
	const a = (args || "").trim().toLowerCase();
	if (a === "t" || a === "tangent") return "t";
	if (a === "ctx" || a === "c") return "ctx";
	return st.lastMode || fallback;
}

export default function btwExtension(pi: ExtensionAPI) {
	const st: State = {
		cfg: loadConfig(),
		threads: { ctx: { mode: "ctx", turns: [] }, t: { mode: "t", turns: [] } },
		lastMode: "ctx",
		busy: false,
	};

	pi.on("session_start", async (_event, ctx) => {
		st.cfg = loadConfig(); // reload-friendly
		// rebuild threads from persisted entries
		const rebuilt: Record<BtwMode, Thread> = { ctx: { mode: "ctx", turns: [] }, t: { mode: "t", turns: [] } };
		let entries: any[] = [];
		try {
			entries = ctx.sessionManager.getEntries() as any[];
		} catch {}
		for (const e of entries) {
			if (e?.type === "custom" && e.customType === "btw:turn" && e.data?.q) {
				const mode: BtwMode = e.data.mode === "t" ? "t" : "ctx";
				rebuilt[mode].turns.push({ q: String(e.data.q), a: String(e.data.a ?? ""), ts: Number(e.data.ts) || Date.now() });
				if (e.data.baseCtx && rebuilt[mode].turns.length === 1) rebuilt[mode].baseCtx = String(e.data.baseCtx);
			}
		}
		if (entries.some((e) => e?.type === "custom" && e.customType === "btw:turn")) st.threads = rebuilt;
		updateWidget(ctx, st);
	});

	pi.registerCommand("btw", {
		description: "btw: side question in the ctx thread (inherits main-session context snapshot)",
		handler: async (args: string, ctx: ExtensionContext) => {
			const q = (args || "").trim();
			if (!q) {
				const c = st.threads.ctx.turns.length;
				const t = st.threads.t.turns.length;
				const m = st.cfg.model || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "?");
				ctx.ui.notify(`btw ▸ ctx:${c} t:${t} · model ${m}${st.cfg.thinkingLevel ? ` (${st.cfg.thinkingLevel})` : ""} · save→${savePath(st.cfg)}`, "info");
				return;
			}
			await ask(pi, ctx, st, "ctx", q);
		},
	});

	pi.registerCommand("btw:t", {
		description: "btw: side question in the tangent thread (no main context)",
		handler: async (args: string, ctx: ExtensionContext) => {
			const q = (args || "").trim();
			if (!q) {
				ctx.ui.notify("用法: /btw:t <问题>（无主上下文的旁路线程）", "info");
				return;
			}
			await ask(pi, ctx, st, "t", q);
		},
	});

	pi.registerCommand("btw:save", {
		description: "btw: re-send a thread through the save system prompt, append organized note",
		getArgumentCompletions: (prefix: string) => {
			const items = ["ctx", "t"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
			return items.length ? items : null;
		},
		handler: async (args: string, ctx: ExtensionContext) => {
			if (st.busy) {
				ctx.ui.notify("btw: 忙，稍等", "warning");
				return;
			}
			const mode = parseModeArg(args, "ctx", st);
			const thread = st.threads[mode];
			if (thread.turns.length === 0) {
				ctx.ui.notify(`btw: ${mode} 线程是空的，没东西可整理`, "warning");
				return;
			}
			st.busy = true;
			try {
				if (ctx.hasUI) ctx.ui.setStatus("btw", "btw: saving…");
				const transcript = thread.turns.map((t, i) => `Q${i + 1} (${fmtTs(t.ts)}): ${t.q}\nA${i + 1}: ${t.a}`).join("\n\n");
				const prompt = `<btw-thread mode="${mode}" turns="${thread.turns.length}">\n${transcript}\n</btw-thread>`;
				const { answer, aborted, error } = await runSideCall(
					ctx,
					st,
					st.cfg.saveModel || st.cfg.model,
					st.cfg.saveThinkingLevel || st.cfg.thinkingLevel,
					st.cfg.saveSystemPrompt || DEFAULT_SAVE_SYSTEM_PROMPT,
					prompt,
				);
				if (ctx.hasUI) ctx.ui.setStatus("btw", undefined);
				if (aborted) {
					ctx.ui.notify("btw: save 已中止", "warning");
					return;
				}
				if (error) {
					ctx.ui.notify(`btw: ${error}`, "error");
					return;
				}
				const head = `## ${fmtTs(Date.now())} · btw:save[${mode}] · ${thread.turns.length} turns`;
				const p = appendNote(st.cfg, `\n${head}\n\n${answer}\n`);
				pi.appendEntry("btw:save-note", { mode, turns: thread.turns.length, path: p, note: answer });
				ctx.ui.notify(`btw: 已整理 ${thread.turns.length} 轮 → ${p}`, "info");
			} finally {
				st.busy = false;
			}
		},
	});

	pi.registerCommand("btw:new", {
		description: "btw: clear threads (args: ctx | t | all, default all)",
		getArgumentCompletions: (prefix: string) => {
			const items = ["all", "ctx", "t"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
			return items.length ? items : null;
		},
		handler: async (args: string, ctx: ExtensionContext) => {
			const a = (args || "").trim().toLowerCase();
			if (a === "ctx") st.threads.ctx = { mode: "ctx", turns: [] };
			else if (a === "t") st.threads.t = { mode: "t", turns: [] };
			else {
				st.threads.ctx = { mode: "ctx", turns: [] };
				st.threads.t = { mode: "t", turns: [] };
			}
			updateWidget(ctx, st);
			ctx.ui.notify("btw: 线程已清空（下次 /btw 会重新快照主上下文）", "info");
		},
	});

	pi.registerEntryRenderer?.("btw:save-note", (entry: any, options: any, theme: any) => {
		const d = entry?.data ?? {};
		const first = String(d.note ?? "").split("\n").find((l: string) => l.trim()) ?? "";
		return new Text(theme.fg("accent", `btw:save[${d.mode}] ${d.turns} 轮 → ${d.path}`) + "\n" + theme.fg("dim", `  ${first.slice(0, 80)}`), options?.outputPad ?? 0, 0);
	});

	pi.registerEntryRenderer?.("btw:turn", (entry: any, options: any, theme: any) => {
		const d = entry?.data ?? {};
		const lines: string[] = [];
		lines.push(theme.fg("accent", `btw[${d.mode}] ${d.q}`));
		for (const raw of String(d.a ?? "").split("\n")) {
			for (const w of wrapLine(raw, Math.max(20, (options?.width ?? 100) - 4))) lines.push(theme.fg("accent", `  ${w}`));
		}
		return new Text(lines.join("\n"), options?.outputPad ?? 0, 0);
	});
}
