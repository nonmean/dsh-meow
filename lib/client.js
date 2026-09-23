window.__ModuleLoader__.load({
	id: "dsh-meow",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/** One wire failure (network errors carry code 'network'). */
		var MeowApiError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.code = code;
			}
		};
		async function request(path, init) {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new MeowApiError("network", error instanceof Error ? error.message : String(error));
			}
			let body;
			try {
				body = await response.json();
			} catch {
				throw new MeowApiError("bad-response", "dsh-meow: response is not JSON");
			}
			const envelope = body;
			if (envelope.ok !== true) throw new MeowApiError(envelope.error?.code ?? "unknown", envelope.error?.message ?? "dsh-meow: request failed");
			return envelope.value;
		}
		/** Read the persisted settings. */
		function getMeowState(signal) {
			return request("/meow/state", {
				signal,
				headers: { accept: "application/json" }
			});
		}
		/** Persist a partial settings patch and return the new settings. */
		function setMeowState(patch) {
			return request("/meow/state", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json"
				},
				body: JSON.stringify(patch)
			});
		}
		/** Read events after a cursor. A negative cursor asks for no backlog. */
		function getMeowEvents(since, signal) {
			return request("/meow/events" + (since < 0 ? "" : "?since=" + String(since)), {
				signal,
				headers: { accept: "application/json" }
			});
		}
		//#endregion
		//#region src/client/audio.ts
		/** Per-kind character. */
		const VOICES = {
			approval: {
				f0: 470,
				wave: "sawtooth",
				seconds: .42
			},
			question: {
				f0: 520,
				wave: "triangle",
				seconds: .4
			},
			error: {
				f0: 290,
				wave: "square",
				seconds: .55
			},
			done: {
				f0: 550,
				wave: "sawtooth",
				seconds: .4
			}
		};
		let audio;
		let unlockInstalled = false;
		/** Lazily create (and cache) the shared AudioContext. */
		function context() {
			if (typeof window === "undefined") return void 0;
			if (audio === void 0) {
				const ctor = window.AudioContext ?? window.webkitAudioContext;
				if (ctor === void 0) return void 0;
				audio = new ctor();
			}
			return audio;
		}
		/**
		* Resume the shared AudioContext on the first user gesture.
		* @returns A disposer removing the gesture listeners.
		*/
		function installAudioUnlock() {
			if (unlockInstalled) return () => {};
			unlockInstalled = true;
			if (typeof window === "undefined") return () => {
				unlockInstalled = false;
			};
			const resume = () => {
				const ctx = context();
				if (ctx !== void 0 && ctx.state === "suspended") ctx.resume();
			};
			window.addEventListener("pointerdown", resume, true);
			window.addEventListener("keydown", resume, true);
			return () => {
				window.removeEventListener("pointerdown", resume, true);
				window.removeEventListener("keydown", resume, true);
				unlockInstalled = false;
			};
		}
		/** Clamp to the 0..1 unit range. */
		function clamp01(value) {
			return Math.min(1, Math.max(0, value));
		}
		/** Schedule one meow on a running context. */
		function schedule(ctx, kind, volume) {
			const voice = VOICES[kind];
			const start = ctx.currentTime + .01;
			const end = start + voice.seconds;
			const master = ctx.createGain();
			master.gain.value = clamp01(volume) * .6;
			master.connect(ctx.destination);
			const formant = ctx.createBiquadFilter();
			formant.type = "bandpass";
			formant.Q.value = 3.2;
			formant.frequency.setValueAtTime(900, start);
			formant.frequency.exponentialRampToValueAtTime(1900, start + voice.seconds * .28);
			formant.frequency.exponentialRampToValueAtTime(650, start + voice.seconds * .85);
			formant.connect(master);
			const osc = ctx.createOscillator();
			osc.type = voice.wave;
			osc.frequency.setValueAtTime(voice.f0 * .85, start);
			osc.frequency.exponentialRampToValueAtTime(voice.f0 * 1.9, start + voice.seconds * .22);
			osc.frequency.exponentialRampToValueAtTime(voice.f0 * .72, start + voice.seconds * .8);
			const envelope = ctx.createGain();
			envelope.gain.setValueAtTime(1e-4, start);
			envelope.gain.exponentialRampToValueAtTime(1, start + .03);
			envelope.gain.setValueAtTime(1, start + voice.seconds * .5);
			envelope.gain.exponentialRampToValueAtTime(1e-4, end);
			osc.connect(envelope);
			envelope.connect(formant);
			osc.start(start);
			osc.stop(end + .02);
		}
		/**
		* Play one meow. Silently no-ops when Web Audio is unavailable or the context
		* is still waiting for a user gesture.
		* @param kind - which event this meow announces.
		* @param volume - requested volume, 0..1.
		*/
		function playMeow(kind, volume) {
			const ctx = context();
			if (ctx === void 0) return;
			if (ctx.state === "running") {
				schedule(ctx, kind, volume);
				return;
			}
			ctx.resume().then(() => {
				if (ctx.state === "running") schedule(ctx, kind, volume);
			}).catch(() => {});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Simplified Chinese copy. */
		const zh = {
			title: "喵叫提示音",
			desc: "在需要确认、需要输入、出现错误或任务完成时播放一声喵叫。",
			onApproval: "需要确认时",
			onQuestion: "需要输入时",
			onError: "出现错误时",
			onDone: "任务完成时",
			includeSubagents: "包含子代理会话",
			volume: "音量",
			test: "试听",
			loading: "加载中…",
			loadFailed: "无法读取提示音设置",
			saveFailed: "保存失败"
		};
		/** English copy. */
		const en = {
			title: "Meow notification sound",
			desc: "Play a meow when DSH needs confirmation, needs input, hits an error, or finishes a turn.",
			onApproval: "Confirmation needed",
			onQuestion: "Input needed",
			onError: "Something went wrong",
			onDone: "Task done",
			includeSubagents: "Include subagent sessions",
			volume: "Volume",
			test: "Test",
			loading: "Loading…",
			loadFailed: "Failed to read the sound settings",
			saveFailed: "Failed to save"
		};
		/** The plugin's locale namespace (dictionary registry key). */
		const LOCALE_NS = "meow";
		let service;
		/** Bind the locale service (apply time); the row re-renders on locale switches. */
		function attachLocale(locale) {
			service = locale;
		}
		/** Current active locale id ('zh' | 'en'), or a browser-language guess. */
		function activeLocale() {
			if (service !== void 0) return service.getSnapshot().active;
			if (typeof navigator !== "undefined") {
				if ((navigator.language ?? "").toLowerCase().split("-")[0] === "zh") return "zh";
			}
			return "en";
		}
		/** Resolve one copy key in the active locale. */
		function translate(key) {
			return (activeLocale() === "zh" ? zh : en)[key] ?? String(key);
		}
		/** React subscription seam for the active locale (useSyncExternalStore). */
		function subscribeLocale(fn) {
			return service?.subscribe(fn) ?? (() => {});
		}
		//#endregion
		//#region src/client/MeowRow.tsx
		/**
		* dsh-meow preference row in the Settings General section.
		*
		* Talks to the same-origin /meow routes. The row owns its own React state; the
		* player reads the state returned by each /meow/events poll, so a toggle takes
		* effect within one poll interval. The master switch is the enable/disable
		* control; the per-event checkboxes, subagent opt-in, volume, and Test control
		* appear only while it is on.
		*
		* @module dsh-meow/client/MeowRow
		*/
		/** Re-render on locale switches (the DSH locale service is uSES-safe). */
		function useLocale() {
			return (0, react.useSyncExternalStore)(subscribeLocale, activeLocale);
		}
		const rowStyle = {
			display: "flex",
			alignItems: "flex-start",
			gap: 8,
			padding: "16px 0",
			borderBottom: "1px solid var(--dsw-alias-border-l2)"
		};
		const leftStyle = {
			flex: 1,
			minWidth: 0,
			display: "flex",
			flexDirection: "column",
			gap: 6,
			paddingRight: 48
		};
		const titleStyle = {
			fontSize: 14,
			fontWeight: 400,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-primary)"
		};
		const descStyle = {
			fontSize: 12,
			fontWeight: 400,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const optionsStyle = {
			display: "flex",
			flexWrap: "wrap",
			alignItems: "center",
			gap: "6px 16px",
			marginTop: 2
		};
		const labelStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer"
		};
		const volumeStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const testStyle = {
			border: "none",
			background: "transparent",
			padding: 0,
			font: "inherit",
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-state-business-primary)",
			cursor: "pointer"
		};
		const errorStyle = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-danger, #d92d20)"
		};
		/** Custom switch: a real checkbox driving a styled track/thumb. */
		function Switch(props) {
			const { checked, disabled, label, onChange } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				style: {
					position: "relative",
					display: "inline-flex",
					flex: "none",
					marginTop: 2,
					cursor: disabled === true ? "default" : "pointer",
					opacity: disabled === true ? .6 : 1
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					style: {
						position: "absolute",
						width: 1,
						height: 1,
						margin: 0,
						opacity: 0
					},
					checked,
					disabled: disabled === true,
					"aria-label": label,
					onChange: (event) => {
						onChange(event.currentTarget.checked);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					style: {
						display: "inline-flex",
						alignItems: "center",
						width: 36,
						height: 20,
						padding: 2,
						boxSizing: "border-box",
						borderRadius: 10,
						border: "1px solid " + (checked ? "var(--dsw-alias-button-primary-fill)" : "var(--dsw-alias-border-l2)"),
						background: checked ? "var(--dsw-alias-button-primary-fill)" : "var(--dsw-alias-bg-layer-1)",
						transition: "background 0.15s ease, border-color 0.15s ease"
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
						display: "block",
						width: 14,
						height: 14,
						borderRadius: "50%",
						background: checked ? "var(--dsw-alias-bg-layer-3)" : "var(--dsw-alias-label-secondary)",
						transform: checked ? "translateX(16px)" : "none",
						transition: "transform 0.15s ease, background 0.15s ease"
					} })
				})]
			});
		}
		/** One labeled checkbox for an event kind. */
		function Check(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				style: {
					...labelStyle,
					opacity: props.disabled ? .6 : 1
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked: props.checked,
					disabled: props.disabled,
					onChange: (event) => {
						props.onChange(event.currentTarget.checked);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.label })]
			});
		}
		/**
		* Render the meow preference row.
		* @returns the row element tree.
		*/
		function MeowRow(_props) {
			useLocale();
			const [state, setState] = (0, react.useState)(null);
			const [draftVolume, setDraftVolume] = (0, react.useState)(.5);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async () => {
				try {
					const fresh = await getMeowState();
					setState(fresh);
					setDraftVolume(fresh.volume);
					setError(null);
				} catch (cause) {
					setError(cause instanceof MeowApiError ? cause.message : translate("loadFailed"));
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const save = (0, react.useCallback)(async (patch) => {
				setBusy(true);
				setError(null);
				setState((current) => current === null ? current : {
					...current,
					...patch
				});
				try {
					const fresh = await setMeowState(patch);
					setState(fresh);
					setDraftVolume(fresh.volume);
				} catch (cause) {
					setError(cause instanceof MeowApiError ? cause.message : translate("saveFailed"));
					await load();
				} finally {
					setBusy(false);
				}
			}, [load]);
			const enabled = state?.enabled === true;
			const locked = busy || state === null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: leftStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: titleStyle,
							children: translate("title")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: descStyle,
							children: translate("desc")
						}),
						state === null && !busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: descStyle,
							children: translate("loading")
						}),
						state !== null && enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: optionsStyle,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Check, {
									checked: state.onApproval,
									disabled: locked,
									label: translate("onApproval"),
									onChange: (value) => {
										save({ onApproval: value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Check, {
									checked: state.onQuestion,
									disabled: locked,
									label: translate("onQuestion"),
									onChange: (value) => {
										save({ onQuestion: value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Check, {
									checked: state.onError,
									disabled: locked,
									label: translate("onError"),
									onChange: (value) => {
										save({ onError: value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Check, {
									checked: state.onDone,
									disabled: locked,
									label: translate("onDone"),
									onChange: (value) => {
										save({ onDone: value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Check, {
									checked: state.includeSubagents,
									disabled: locked,
									label: translate("includeSubagents"),
									onChange: (value) => {
										save({ includeSubagents: value });
									}
								})
							]
						}),
						state !== null && enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: optionsStyle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: volumeStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: translate("volume") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "range",
									min: 0,
									max: 1,
									step: .05,
									value: draftVolume,
									disabled: locked,
									"aria-label": translate("volume"),
									onChange: (event) => {
										setDraftVolume(Number(event.currentTarget.value));
									},
									onPointerUp: () => {
										save({ volume: draftVolume });
									},
									onKeyUp: () => {
										save({ volume: draftVolume });
									}
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: testStyle,
								onClick: () => {
									playMeow("done", draftVolume);
								},
								children: translate("test")
							})]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "alert",
							style: errorStyle,
							children: error
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
					checked: enabled,
					disabled: locked,
					label: translate("title"),
					onChange: (value) => {
						save({ enabled: value });
					}
				})]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Services required before mounting: NONE - an inject-less row starts in the
		* first boot wave. The slots/locale surfaces mount from a child fiber that
		* waits for those services.
		*/
		const inject = [];
		/** Poll cadence for queued meows; low latency without a busy loop. */
		const POLL_INTERVAL_MS = 700;
		/** Whether the current settings enable one event kind. */
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
		* Client plugin body.
		* @param ctx - the client cordis context (slots/locale via child fiber).
		*/
		function apply(ctx) {
			ctx.inject(["slots", "locale"], (uiCtx) => {
				attachLocale(uiCtx.locale);
				uiCtx.effect(() => {
					const offZh = uiCtx.locale.register(LOCALE_NS, "zh", zh);
					const offEn = uiCtx.locale.register(LOCALE_NS, "en", en);
					return () => {
						offZh();
						offEn();
					};
				}, "dsh-meow: dictionaries");
				uiCtx.slots.inject("settings.general.item", () => uiCtx.slots.register({
					name: "settings.general.item",
					id: "meow",
					order: 16,
					inject: () => ({})
				}, MeowRow));
				uiCtx.effect(() => installAudioUnlock(), "dsh-meow: audio unlock");
				let cursor = -1;
				let stopped = false;
				let timer;
				const poll = async () => {
					try {
						const payload = await getMeowEvents(cursor);
						cursor = payload.cursor;
						for (const event of payload.events) if (kindEnabled(payload.state, event.kind)) playMeow(event.kind, payload.state.volume);
					} catch {}
					if (!stopped) timer = window.setTimeout(() => {
						poll();
					}, POLL_INTERVAL_MS);
				};
				uiCtx.effect(() => () => {
					stopped = true;
					if (timer !== void 0) window.clearTimeout(timer);
				}, "dsh-meow: event poll");
				poll();
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map