import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
//#region src/index.ts
/**
* dsh-meow host half.
*
* Observes the four moments worth hearing and serves them to the browser half
* over same-origin JSON routes:
*
*   GET  /meow/state            -> { ok: true, value: MeowState }
*   POST /meow/state            -> { ok: true, value: MeowState }  (partial patch body)
*   GET  /meow/events?since=N   -> { ok: true, value: { events, cursor, state } }
*
* Observation points:
* - confirmation needed: a prepended listener on the approval/request
*   waterfall. The approval service resolves the 'never' policy before
*   dispatch, so this fires only when a human or answerer is actually asked
*   (unlike the approval/asked audit event, which is logged even under
*   'never').
* - input needed: a prepended listener on the user-questions/request
*   waterfall, so it observes the request before the browser answerer claims
*   it and delegates with next().
* - something wrong: turn/end whose reason is 'error'.
* - task done: turn/end whose reason is 'completed'.
*
* Settings live in a plugin-owned file under the harness home (default
* $DSH_HOME/dsh-meow.json) rather than the settings plane, so the Settings
* toggle is self-contained and needs no profile reload.
*
* @module dsh-meow
*/
/** Stable Cordis plugin name (the loader row mounts this package). */
const name = "dsh-meow";
/** File name of the plugin-owned settings document under the harness home. */
const MEOW_STATE_FILE = "dsh-meow.json";
/** Retained event backlog served to a reconnecting browser half. */
const MAX_EVENTS = 128;
/** Minimum gap between two meows of the same kind; avoids storming a burst. */
const COOLDOWN_MS = 600;
/** Request-body size bound of the POST route. */
const MAX_BODY_BYTES = 16 * 1024;
/** Settings used before the user has saved any. */
const DEFAULT_MEOW_STATE = {
	enabled: true,
	onApproval: true,
	onQuestion: true,
	onError: true,
	onDone: true,
	includeSubagents: false,
	volume: .5
};
/** Absolute path of the plugin state document. */
function statePath(ctx) {
	const dshHomePath = ctx.get("dshHomePath");
	if (typeof dshHomePath === "function") return dshHomePath(MEOW_STATE_FILE);
	return join(typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME : join(homedir(), ".dsh"), MEOW_STATE_FILE);
}
/** Fold an arbitrary stored/patch value into a complete, validated state. */
function normalizeState(raw) {
	const record = typeof raw === "object" && raw !== null ? raw : {};
	const bool = (key) => typeof record[key] === "boolean" ? record[key] : DEFAULT_MEOW_STATE[key];
	const volume = typeof record.volume === "number" && Number.isFinite(record.volume) ? Math.min(1, Math.max(0, record.volume)) : DEFAULT_MEOW_STATE.volume;
	return {
		enabled: bool("enabled"),
		onApproval: bool("onApproval"),
		onQuestion: bool("onQuestion"),
		onError: bool("onError"),
		onDone: bool("onDone"),
		includeSubagents: bool("includeSubagents"),
		volume
	};
}
/** The boolean settings keys, for partial-patch application. */
const BOOLEAN_KEYS = [
	"enabled",
	"onApproval",
	"onQuestion",
	"onError",
	"onDone",
	"includeSubagents"
];
/** Apply a partial, untrusted patch, keeping the current value for invalid fields. */
function applyPatch(state, patch) {
	const next = { ...state };
	for (const key of BOOLEAN_KEYS) {
		const value = patch[key];
		if (typeof value === "boolean") next[key] = value;
	}
	const volume = patch.volume;
	if (typeof volume === "number" && Number.isFinite(volume)) next.volume = Math.min(1, Math.max(0, volume));
	return next;
}
/** Read the persisted settings; a missing or unreadable file means defaults. */
function readState(ctx) {
	try {
		return normalizeState(JSON.parse(readFileSync(statePath(ctx), "utf8")));
	} catch {
		return { ...DEFAULT_MEOW_STATE };
	}
}
/** Persist the settings (single JSON document). */
function persistState(ctx, state) {
	const path = statePath(ctx);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}
/** Whether one kind is enabled by the current settings. */
function kindEnabled(state, kind) {
	switch (kind) {
		case "approval": return state.onApproval;
		case "question": return state.onQuestion;
		case "error": return state.onError;
		case "done": return state.onDone;
		default: return false;
	}
}
/**
* Settings plus the bounded, deduplicated event backlog the browser half polls.
*/
var MeowController = class {
	ctx;
	state;
	events = [];
	nextSeq = 1;
	lastEmitAt = /* @__PURE__ */ new Map();
	/**
	* @param ctx - host context used to locate and persist the settings file.
	*/
	constructor(ctx) {
		this.ctx = ctx;
		this.state = readState(ctx);
	}
	/** The current settings copy. */
	snapshot() {
		return { ...this.state };
	}
	/** Merge a partial patch, persist it, and return the new settings. */
	update(patch) {
		this.state = applyPatch(this.state, patch);
		persistState(this.ctx, this.state);
		return this.snapshot();
	}
	/** Whether a turn on this session should be announced. */
	includesSession(session) {
		if (this.state.includeSubagents) return true;
		return (session.header.delegationDepth ?? 0) === 0;
	}
	/** Queue one meow if it is enabled and outside its cooldown. */
	emit(kind) {
		if (!this.state.enabled) return;
		if (!kindEnabled(this.state, kind)) return;
		const now = Date.now();
		if (now - (this.lastEmitAt.get(kind) ?? 0) < COOLDOWN_MS) return;
		this.lastEmitAt.set(kind, now);
		this.events.push({
			seq: this.nextSeq,
			kind,
			at: now
		});
		this.nextSeq += 1;
		if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
	}
	/**
	* Events after a caller cursor plus the current cursor. A non-finite cursor
	* (the browser half's first poll) returns no events, so a page load never
	* replays a backlog.
	*/
	eventsSince(since) {
		const cursor = this.nextSeq - 1;
		if (!Number.isFinite(since)) return {
			events: [],
			cursor
		};
		return {
			events: this.events.filter((event) => event.seq > since),
			cursor
		};
	}
};
/** Subscribe the four observation points. */
function observe(ctx, controller) {
	ctx.on("approval/request", (_request, next) => {
		controller.emit("approval");
		return next();
	}, true);
	ctx.on("user-questions/request", (_request, next) => {
		controller.emit("question");
		return next();
	}, true);
	ctx.on("session/event", (session, event) => {
		if (event.type !== "turn/end") return;
		if (!controller.includesSession(session)) return;
		const reason = event.data.reason.kind;
		if (reason === "completed") controller.emit("done");
		else if (reason === "error") controller.emit("error");
	});
}
/** Write one JSON response. */
function writeJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** Reject cross-site browser callers; the routes are same-origin only. */
function trusted(req) {
	return req.headers["sec-fetch-site"] !== "cross-site";
}
/** Read a bounded JSON request body. */
async function readJsonBody(req) {
	return await new Promise((resolve) => {
		const chunks = [];
		let total = 0;
		req.on("data", (chunk) => {
			total += chunk.length;
			if (total > MAX_BODY_BYTES) {
				resolve(null);
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			const text = Buffer.concat(chunks).toString("utf8");
			if (text.trim() === "") {
				resolve({});
				return;
			}
			try {
				const value = JSON.parse(text);
				resolve(typeof value === "object" && value !== null && !Array.isArray(value) ? value : null);
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => resolve(null));
	});
}
/** Mount the /meow routes on the web server. */
function registerRoutes(ctx, controller) {
	ctx.inject(["webServer"], (httpCtx) => {
		httpCtx.effect(() => {
			const disposers = [];
			disposers.push(httpCtx.webServer.register({
				kind: "exact",
				path: "/meow/state",
				handler: (req, res) => {
					if (!trusted(req)) {
						writeJson(res, 403, {
							ok: false,
							error: {
								code: "forbidden",
								message: "cross-site request refused"
							}
						});
						return;
					}
					if (req.method === "GET") {
						writeJson(res, 200, {
							ok: true,
							value: controller.snapshot()
						});
						return;
					}
					if (req.method === "POST") {
						readJsonBody(req).then((body) => {
							if (body === null) {
								writeJson(res, 400, {
									ok: false,
									error: {
										code: "bad-request",
										message: "expected a JSON object body"
									}
								});
								return;
							}
							writeJson(res, 200, {
								ok: true,
								value: controller.update(body)
							});
						});
						return;
					}
					writeJson(res, 405, {
						ok: false,
						error: {
							code: "method-error",
							message: "method not allowed"
						}
					});
				}
			}));
			disposers.push(httpCtx.webServer.register({
				kind: "exact",
				path: "/meow/events",
				handler: (req, res) => {
					if (!trusted(req)) {
						writeJson(res, 403, {
							ok: false,
							error: {
								code: "forbidden",
								message: "cross-site request refused"
							}
						});
						return;
					}
					if (req.method !== "GET") {
						writeJson(res, 405, {
							ok: false,
							error: {
								code: "method-error",
								message: "method not allowed"
							}
						});
						return;
					}
					const sinceRaw = new URL(req.url ?? "/meow/events", "http://dsh.internal").searchParams.get("since");
					const since = sinceRaw === null ? NaN : Number(sinceRaw);
					const slice = controller.eventsSince(since);
					writeJson(res, 200, {
						ok: true,
						value: {
							events: slice.events,
							cursor: slice.cursor,
							state: controller.snapshot()
						}
					});
				}
			}));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-meow: routes");
	});
}
/**
* Host plugin body: observe the four moments and serve the browser half.
* @param ctx - host cordis root.
*/
function apply(ctx) {
	const controller = new MeowController(ctx);
	observe(ctx, controller);
	registerRoutes(ctx, controller);
	ctx.logger.info("[dsh-meow] ready (enabled=%s)", controller.snapshot().enabled ? "true" : "false");
}
//#endregion
export { DEFAULT_MEOW_STATE, MEOW_STATE_FILE, apply, name };
