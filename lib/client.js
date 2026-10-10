window.__ModuleLoader__.load({
	id: "dsh-sys-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var h = react.createElement;
		var PACKAGE_NAME = "dsh-sys-monitor";
		/** Browser-relative form of the Host sample route. */
		var SAMPLE_ROUTE = "/api/sys-monitor.sample".slice(1);
		/** One collection per second, the cadence the Host sampler runs at. */
		var POLL_INTERVAL_MS = 1000;
		/** Locale namespace owned by this plugin. */
		var NS = "sys-monitor";
		/** Where the panel's chosen colours survive a reload. */
		var APPEARANCE_KEY = "dsh-sys-monitor.appearance";
		/** Where the panel was parked, so it opens where it was left. */
		var POSITION_KEY = "dsh-sys-monitor.position";
		/**
		* The panel's width, matching the stylesheet: a drag is clamped against
		* it, and collapsing the panel does not give it another one — the same
		* box, drawing less of itself.
		*/
		var PANEL_WIDTH = 272;
		/**
		* How much of the panel has to stay on screen. A panel parked entirely
		* off screen cannot be dragged back.
		*/
		var KEEP_VISIBLE = 24;
		/**
		* The size the panel's own text is written at, which is also the size
		* every other size in the panel is measured against: a row caption is
		* this size, the collapsed panel's total 14px of it.
		*/
		var BASE_SIZE = 11;
		/**
		* The panel as the theme drew it: every colour field is the empty
		* string, which the stylesheet reads as "use the theme token", the font
		* is the empty string, which the stylesheet reads as "inherit", every
		* opacity is at full strength, and the text is `BASE_SIZE` pixels.
		*/
		var DEFAULT_APPEARANCE = {
			bg: "",
			bgAlpha: 100,
			text: "",
			bar: "",
			barAlpha: 100,
			border: "",
			blur: 0,
			font: "",
			size: BASE_SIZE
		};
		/** The range each numeric field is allowed to take, slider bounds included. */
		var APPEARANCE_RANGE = {
			bgAlpha: [0, 100],
			barAlpha: [0, 100],
			blur: [0, 24]
		};
		/**
		* The text sizes the panel offers, in the pixels its own text is written
		* at. A menu and not a slider, and the difference is not a matter of
		* taste: every one of these values lays the whole panel out again, and a
		* slider doing that under the pointer that is dragging it moves the box
		* that pointer is measured against — the panel fights the hand, and the
		* number in the row keeps changing after the hand has stopped.
		*
		* The ends are 9px, the smallest text that is still readable at this
		* density, and 15px, the largest the panel is drawn at.
		* `dsh-token-usage` offers the same sizes in the same order, so a size
		* chosen in one panel is the same size in the other; its panel is the
		* taller of the two, and its comment says what the ceiling looks like.
		*/
		var TEXT_SIZES = [9, 10, 11, 12, 13, 14, 15];
		/**
		* The faces the panel offers, and the label each is listed under. The
		* first is the empty key, which is the page's own face: a panel nobody
		* has touched must not pick a font of its own, and one that did would
		* not match the panel it sits beside.
		*
		* The rest are stacks rather than single names on purpose. A face this
		* machine does not have has to fall through to the next one in the list,
		* and every stack ends in a generic family, which is a face that always
		* exists — a single name that happens to be missing leaves the browser
		* with nothing but the panel's inherited one, silently.
		*
		* What a stored record holds is the *key*, never the stack. The value
		* that reaches the stylesheet is looked up from this table, so a
		* hand-edited record cannot put a declaration of its own in front of one
		* of these rules. The two panels list the same stacks in the same order,
		* so a face chosen in one is the same face in the other.
		*/
		var FONT_STACKS = [
			{ key: "", stack: "", label: "font.theme" },
			{ key: "mono", stack: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", label: "font.mono" },
			{ key: "sans", stack: "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif", label: "font.sans" },
			{ key: "serif", stack: "ui-serif,Georgia,'Times New Roman',serif", label: "font.serif" }
		];
		/** Every key a stored record may hold, which is what makes a font a choice rather than a string. */
		var FONT_KEYS = FONT_STACKS.map(function (entry) {
			return entry.key;
		});
		/** The token whose colour each swatch shows while the field follows the theme. */
		var APPEARANCE_TOKEN = {
			bg: "--dsw-alias-bg-layer-2",
			text: "--dsw-alias-label-primary",
			bar: "--dsw-alias-brand-primary",
			border: "--dsw-alias-border-l1"
		};
		/** Fallback swatches for tokens that resolve to a colour a hex input cannot hold. */
		var APPEARANCE_FALLBACK = {
			bg: "#1c1c20",
			text: "#e8e8ec",
			bar: "#4d8dfa",
			border: "#3a3a42"
		};
		var swatchCache = {};
		/** Simplified-Chinese strings. */
		var zh = {
			"panel.title": "系统监控",
			"panel.collapse": "收起",
			"panel.expand": "展开",
			"panel.settings": "设置",
			"panel.drag": "拖动可移动位置，双击回到右上角",
			"set.bg": "背景颜色",
			"set.bgAlpha": "背景透明度",
			"set.text": "文字颜色",
			"set.border": "边框颜色",
			"set.bar": "进度条颜色",
			"set.barAlpha": "进度条透明度",
			"set.blur": "背景模糊",
			"set.font": "字体",
			"font.theme": "跟随主题",
			"font.mono": "等宽",
			"font.sans": "无衬线",
			"font.serif": "衬线",
			"set.size": "字号",
			"set.theme": "跟随主题",
			"set.reset": "恢复默认",
			"row.cpu": "CPU",
			"row.mem": "内存",
			"row.gpu": "GPU",
			"row.down": "下行",
			"row.up": "上行",
			"hint.cores": "核",
			"hint.levels": "分档",
			"hint.load": "平均负载",
			"hint.clock": "频率",
			"hint.nominalClock": "标称频率",
			"hint.noClock": "无频率数据",
			"hint.memUsed": "已用",
			"hint.compressed": "压缩内存",
			"hint.swap": "交换空间",
			"hint.gpuMemory": "已用显存",
			"hint.renderer": "渲染器",
			"hint.tiler": "分块器",
			"hint.interfaces": "个接口",
			"hint.fullScale": "满量程",
			"hint.splitUnavailable": "该 CPU 未提供分核档位",
			"hint.clockFallback": "频率为标称值",
			"hint.gpuUnavailable": "该 GPU 未提供利用率计数器",
			"hint.offline": "采样不可用"
		};
		/** English strings. */
		var en = {
			"panel.title": "System Monitor",
			"panel.collapse": "Collapse",
			"panel.expand": "Expand",
			"panel.settings": "Settings",
			"panel.drag": "Drag to move the panel · double-click to send it home",
			"set.bg": "Background",
			"set.bgAlpha": "Background opacity",
			"set.text": "Text",
			"set.border": "Border",
			"set.bar": "Bar colour",
			"set.barAlpha": "Bar opacity",
			"set.blur": "Background blur",
			"set.font": "Font",
			"font.theme": "Follow the theme",
			"font.mono": "Monospace",
			"font.sans": "Sans",
			"font.serif": "Serif",
			"set.size": "Text size",
			"set.theme": "Follow the theme",
			"set.reset": "Reset to defaults",
			"row.cpu": "CPU",
			"row.mem": "Memory",
			"row.gpu": "GPU",
			"row.down": "Down",
			"row.up": "Up",
			"hint.cores": "cores",
			"hint.levels": "levels",
			"hint.load": "load average",
			"hint.clock": "clock",
			"hint.nominalClock": "nominal clock",
			"hint.noClock": "no clock reported",
			"hint.memUsed": "used",
			"hint.compressed": "compressed",
			"hint.swap": "swap",
			"hint.gpuMemory": "GPU memory in use",
			"hint.renderer": "renderer",
			"hint.tiler": "tiler",
			"hint.interfaces": "interfaces",
			"hint.fullScale": "full scale",
			"hint.splitUnavailable": "this CPU publishes no perf-level split",
			"hint.clockFallback": "clocks are nominal",
			"hint.gpuUnavailable": "this GPU publishes no utilization counter",
			"hint.offline": "sampling unavailable"
		};
		/**
		* The panel's stylesheet, written into the page on every run.
		*
		* The panel is two elements, and the split is not cosmetic: `zoom` is on
		* `.dshsm__box`, the panel that is drawn, and *not* on `.dshsm`, the
		* element the panel is positioned with. Chromium scales a zoomed box's
		* own `left`, `top` and `bottom` by the same factor it scales its size,
		* so a `zoom` on the positioned element turns every drag into a
		* conversion between two coordinate spaces and puts the panel where the
		* pointer was not — and a conversion is exactly the sort of thing that
		* works at one text size and not at another. On the outer element the
		* offsets are plain screen pixels at every size, the corner is a plain
		* 10px, and a stored position means the same thing whatever the panel is
		* drawn at.
		*
		* The root's width is the drawn width and nothing else. A zoomed child
		* already brings its height back to the parent, so the vertical is right on
		* its own; a width pinned at 272px under a panel that is drawn 371px wide
		* is a panel whose right-hand 99px hang off the edge of the window at 15px,
		* and whose parked 10px gap is 10px only in a panel nobody can see the end
		* of.
		*/
		var css = ".dshsm{position:fixed;top:10px;right:10px;z-index:40;pointer-events:auto;width:calc(272px * var(--dshsm-scale,1));-webkit-app-region:no-drag}.dshsm__box{display:flex;flex-direction:column;box-sizing:border-box;width:272px;border:1px solid var(--dshsm-line,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dshsm-bg,var(--dsw-alias-bg-layer-2));-webkit-backdrop-filter:blur(var(--dshsm-blur,0px));backdrop-filter:blur(var(--dshsm-blur,0px));color:var(--dshsm-fg,var(--dsw-alias-label-primary));box-shadow:0 6px 22px rgba(0,0,0,.18);font-family:var(--dshsm-font,inherit);font-size:11px;line-height:1.4;overflow:hidden;zoom:var(--dshsm-scale,1)}.dshsm--tinted .dshsm__box{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) var(--dshsm-bg-alpha,100%),transparent)}.dshsm--tinted-bars .dshsm__fill{background:color-mix(in srgb,var(--dshsm-row,var(--dsw-alias-brand-primary)) var(--dshsm-bar-alpha,100%),transparent)}.dshsm--up .dshsm__box{flex-direction:column-reverse}.dshsm--up .dshsm__head{border-bottom:0;border-top:1px solid var(--dshsm-line,var(--dsw-alias-border-l1))}.dshsm--up.dshsm--mini .dshsm__head{border-top:0}.dshsm--placed{right:auto}.dshsm--dragging{user-select:none}.dshsm__head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dshsm-line,var(--dsw-alias-border-l1))}.dshsm__title{flex:1;min-width:0;font-weight:600;font-size:11px;color:var(--dshsm-fg-2,var(--dsw-alias-label-secondary));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}.dshsm--dragging .dshsm__title{cursor:grabbing}.dshsm__toggle{flex:none;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:0;border-radius:5px;background:transparent;color:var(--dshsm-fg-2,var(--dsw-alias-label-secondary));cursor:pointer;font-size:10px;line-height:1;padding:0}.dshsm__toggle:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dshsm-fg,var(--dsw-alias-label-primary))}.dshsm__toggle--on{color:var(--dsw-alias-brand-primary)}.dshsm__fold::before{content:'▸';display:block;line-height:1;transition:transform .18s ease}.dshsm__fold--open::before{transform:rotate(90deg)}.dshsm--up .dshsm__fold--open::before{transform:rotate(-90deg)}.dshsm__rows{display:flex;flex-direction:column;gap:5px;padding:7px 8px 8px}.dshsm__row{display:flex;align-items:center;gap:8px}.dshsm__label{flex:none;width:26px;text-align:center;color:var(--dshsm-fg-2,var(--dsw-alias-label-secondary));font-weight:600;cursor:help}.dshsm__track{flex:1;min-width:0;height:6px;border-radius:3px;background:var(--dshsm-track,var(--dsw-alias-bg-layer-1));box-shadow:inset 0 0 0 1px var(--dshsm-line,var(--dsw-alias-border-l1));overflow:hidden}.dshsm__fill{display:block;height:100%;border-radius:3px;transition:width .35s ease;background:var(--dshsm-bar,var(--dshsm-row,var(--dsw-alias-brand-primary)))}.dshsm__value{flex:none;width:104px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshsm--mini .dshsm__head{border-bottom:0;padding:5px 8px}.dshsm--mini .dshsm__title{flex:0 1 auto}.dshsm__mini{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden}.dshsm__row--mini{flex:1 1 0;min-width:0;gap:4px}.dshsm__row--mini .dshsm__label{width:auto;font-size:10px}.dshsm__row--mini .dshsm__value{width:auto;min-width:22px;font-size:10px}.dshsm__row--mini .dshsm__track{height:4px;border-radius:2px}.dshsm__note{padding:1px 8px 5px;font-size:10px;color:var(--dshsm-fg-3,var(--dsw-alias-label-tertiary));white-space:normal;word-break:break-word}.dshsm__foot{padding:0 8px 7px;font-size:10px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshsm--error .dshsm__box{border-color:var(--dsw-alias-state-warn-primary)}.dshsm__gear{font-size:12px}.dshsm__settings{display:flex;flex-direction:column;gap:5px;margin-top:3px;padding-top:7px;border-top:1px solid var(--dshsm-line,var(--dsw-alias-border-l1));background:var(--dshsm-bg2,transparent)}.dshsm__set{display:flex;align-items:center;gap:6px}.dshsm__set-name{flex:1;min-width:0;color:var(--dshsm-fg-2,var(--dsw-alias-label-secondary));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dshsm__set-color{-webkit-appearance:none;appearance:none;flex:none;width:26px;height:16px;padding:0;border:1px solid var(--dshsm-line,var(--dsw-alias-border-l1));border-radius:4px;background:transparent;cursor:pointer}.dshsm__set-color::-webkit-color-swatch-wrapper{padding:0}.dshsm__set-color::-webkit-color-swatch{border:0;border-radius:3px}.dshsm__set-color::-moz-color-swatch{border:0;border-radius:3px}.dshsm__set-color--theme{opacity:.45}.dshsm__set-theme{flex:none;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dshsm-fg-2,var(--dsw-alias-label-secondary));cursor:pointer;font-size:10px;line-height:1}.dshsm__set-theme:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}.dshsm__set-theme:disabled{opacity:.35;cursor:default}.dshsm__set-range{flex:none;width:74px;height:16px;margin:0;background:transparent;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}.dshsm__set-menu{flex:none;width:98px;height:18px;box-sizing:border-box;padding:1px 4px;border:1px solid var(--dshsm-line,var(--dsw-alias-border-l1));border-radius:5px;background:var(--dshsm-bg2,var(--dsw-alias-bg-layer-3));color:var(--dshsm-fg,var(--dsw-alias-label-primary));font-family:inherit;font-size:10px;line-height:1.3;cursor:pointer}.dshsm__set-menu:hover{border-color:var(--dsw-alias-brand-primary)}.dshsm__set-num{flex:none;width:28px;text-align:right;color:var(--dshsm-fg-3,var(--dsw-alias-label-tertiary));font-variant-numeric:tabular-nums}.dshsm__set-reset{padding:3px 0;border:1px solid var(--dshsm-line,var(--dsw-alias-border-l1));border-radius:5px;background:transparent;color:var(--dshsm-fg-2,var(--dsw-alias-label-secondary));cursor:pointer;font-family:inherit;font-size:10px}.dshsm__set-reset:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dshsm-fg,var(--dsw-alias-label-primary))}.dshsm__set-reset:disabled{opacity:.4;cursor:default}@media (prefers-reduced-motion:reduce){.dshsm__fill{transition:none}.dshsm__fold::before{transition:none}}";
		var cssTagId = PACKAGE_NAME + "/MonitorPanel.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null) {
			var cssTag = document.createElement("style");
			cssTag.dataset.plugin = PACKAGE_NAME;
			cssTag.dataset.pluginCss = cssTagId;
			cssTag.textContent = css;
			document.head.appendChild(cssTag);
		}
		/**
		* The page's own storage, or null where there is none to talk to: a
		* private window throws on access rather than returning null, and the
		* panel must still paint when it does.
		* @returns a Storage, or null.
		*/
		function storage() {
			try {
				if (typeof window === "undefined" || !window.localStorage) return null;
				return window.localStorage;
			} catch (error) {
				return null;
			}
		}
		/**
		* Three bytes of a `#rgb` or `#rrggbb` string, or undefined when the
		* string is not a hex colour. Storage is user-writable, so every colour
		* that comes back is checked before it can reach a stylesheet.
		* @param hex - the colour as written.
		* @returns the channels, or undefined.
		*/
		function parseHex(hex) {
			if (typeof hex !== "string") return undefined;
			var text = hex.trim().replace(/^#/, "");
			if (/^[0-9a-f]{3}$/i.test(text)) {
				text = text[0] + text[0] + text[1] + text[1] + text[2] + text[2];
			}
			if (!/^[0-9a-f]{6}$/i.test(text)) return undefined;
			return [parseInt(text.slice(0, 2), 16), parseInt(text.slice(2, 4), 16), parseInt(text.slice(4, 6), 16)];
		}
		/**
		* Three channels as a CSS colour at a given strength.
		* @param rgb - the channels, 0..255.
		* @param alpha - opacity, 0..1.
		* @returns a CSS rgba() string.
		*/
		function rgbaText(rgb, alpha) {
			return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
		}
		/**
		* One colour moved away from a base towards white or black, whichever
		* the base is further from. A surface derived from a colour the user
		* chose has to be nudged by hand, because no theme token describes it:
		* this is what keeps the trough, the border and the settings block
		* readable on an arbitrary background.
		* @param rgb - the base channels.
		* @param mix - how far to move, 0..1.
		* @param alpha - opacity, 0..1.
		* @returns a CSS rgba() string.
		*/
		function shade(rgb, mix, alpha) {
			var towards = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.5 ? 255 : 0;
			var channels = [];
			for (var index = 0; index < 3; index++) {
				channels.push(Math.round(rgb[index] + (towards - rgb[index]) * mix));
			}
			return rgbaText(channels, alpha);
		}
		/**
		* A colour read as an edge against a base rather than as a surface on it:
		* the base's own opposite, so a border is always visible on it. `shade`
		* cannot do this — it walks *away* from mid-grey, which on a black panel
		* yields rgba(0,0,0,.5), the panel's own colour, and the border vanishes
		* exactly when the user has chosen a colour worth seeing.
		* @param rgb - the base channels.
		* @param mix - how far to move, 0..1.
		* @param alpha - opacity, 0..1.
		* @returns a CSS rgba() string.
		*/
		function edge(rgb, mix, alpha) {
			var towards = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.5 ? 0 : 255;
			var channels = [];
			for (var index = 0; index < 3; index++) {
				channels.push(Math.round(rgb[index] + (towards - rgb[index]) * mix));
			}
			return rgbaText(channels, alpha);
		}
		/**
		* One appearance record, every field of it checked. An unreadable or
		* hand-edited value falls back to the default for that one field rather
		* than taking the whole panel down with it.
		* @param raw - the record as stored, possibly anything at all.
		* @returns a record shaped exactly like DEFAULT_APPEARANCE.
		*/
		function sanitizeAppearance(raw) {
			var next = {};
			var field;
			for (field in DEFAULT_APPEARANCE) next[field] = DEFAULT_APPEARANCE[field];
			if (raw === null || typeof raw !== "object") return next;
			for (field in DEFAULT_APPEARANCE) {
				var value = raw[field];
				if (value === null || value === undefined) continue;
				var range = APPEARANCE_RANGE[field];
				if (range !== undefined) {
					if (typeof value === "number" && Number.isFinite(value)) {
						next[field] = Math.max(range[0], Math.min(range[1], Math.round(value)));
					}
				} else if (field === "font") {
					// A font is one of the keys in the table, never a stack of
					// its own: an unknown key falls back to the theme's face
					// rather than carrying whatever the record said into the
					// stylesheet.
					if (FONT_KEYS.indexOf(value) !== -1) next[field] = value;
				} else if (field === "size") {
					// A size is one of the sizes on offer, the same way a
					// colour is one hex value or the other: a number this
					// build does not draw at is not clamped into one, it is
					// the one the panel was drawn at before anyone asked.
					if (TEXT_SIZES.indexOf(value) !== -1) next[field] = value;
				} else if (parseHex(value) !== undefined) {
					next[field] = value;
				}
			}
			return next;
		}
		/**
		* Whether a record still asks for nothing, which is what puts the reset
		* button out of reach.
		* @param appearance - a sanitized record.
		* @returns true when every field equals the default.
		*/
		function isDefaultAppearance(appearance) {
			for (var field in DEFAULT_APPEARANCE) {
				if (appearance[field] !== DEFAULT_APPEARANCE[field]) return false;
			}
			return true;
		}
		/**
		* The appearance the panel should open with.
		* @returns a sanitized record.
		*/
		function loadAppearance() {
			var store = storage();
			if (store === null) return sanitizeAppearance(null);
			try {
				return sanitizeAppearance(JSON.parse(store.getItem(APPEARANCE_KEY)));
			} catch (error) {
				return sanitizeAppearance(null);
			}
		}
		/**
		* Keep a record across reloads. Nothing here is worth an exception when
		* the write is refused, so a failure is swallowed.
		* @param appearance - a sanitized record.
		* @returns nothing.
		*/
		function saveAppearance(appearance) {
			var store = storage();
			if (store === null) return;
			try {
				store.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
			} catch (error) {}
		}
		/**
		* The face one key stands for, looked up in the table rather than
		* assembled from the record. A key the table does not have — one from a
		* future build, or a hand-edited record — is the empty string, which the
		* panel reads as "use the page's own face" instead of drawing with
		* nothing.
		* @param key - a key from the stored record.
		* @returns the CSS font stack, or the empty string.
		*/
		function fontStack(key) {
			for (var index = 0; index < FONT_STACKS.length; index++) {
				if (FONT_STACKS[index].key === key) return FONT_STACKS[index].stack;
			}
			return "";
		}
		/**
		* The swatch a colour input shows while its field still follows the
		* theme: the token's own colour when it resolves to plain rgb, and a
		* neutral guess when it resolves to a colour space a hex input cannot
		* hold. A wrong swatch would be worse than a plain one, and the field's
		* dimmed border says the colour is not in use anyway.
		* @param field - "bg", "text", "border" or "bar".
		* @returns a hex colour.
		*/
		function swatchFor(field) {
			if (swatchCache[field] === undefined) {
				swatchCache[field] = APPEARANCE_FALLBACK[field];
				try {
					if (typeof document !== "undefined" && document.body && typeof getComputedStyle === "function") {
						var probe = document.createElement("span");
						probe.style.display = "none";
						probe.style.color = "var(" + APPEARANCE_TOKEN[field] + ")";
						var resolved;
						try {
							document.body.appendChild(probe);
							resolved = getComputedStyle(probe).color;
						} finally {
							// The probe is thrown away either way; a half-attached
							// one would outlive the popover it was made for.
							if (probe.parentNode !== null) probe.parentNode.removeChild(probe);
						}
						var rgb = parseRgbColor(resolved);
						if (rgb !== undefined) {
							swatchCache[field] = "#" + rgb.map(function (channel) {
								return ("0" + channel.toString(16)).slice(-2);
							}).join("");
						}
					}
				} catch (error) {}
			}
			return swatchCache[field];
		}
		/**
		* The channels of a computed `rgb()` or `rgba()` colour.
		* @param value - a computed colour string.
		* @returns the channels, or undefined for any other notation.
		*/
		function parseRgbColor(value) {
			if (typeof value !== "string") return undefined;
			var match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
			if (match === null) return undefined;
			return [Number(match[1]), Number(match[2]), Number(match[3])];
		}
		/**
		* The custom properties one appearance record asks the panel to carry.
		* Only the fields an override touches are set, so a panel that follows
		* the theme keeps inheriting every token it inherited before, and the
		* surfaces derived from a custom background — trough, border, settings
		* block — are shaded from that background rather than left to a token
		* that was drawn for a different surface. A colour the user chose carries
		* its own opacity, because the one case `color-mix` is needed for is the
		* theme token, which arrives here as a name and not as a colour.
		* @param appearance - a sanitized record.
		* @returns a style object of custom properties.
		*/
		function panelStyle(appearance) {
			var style = {};
			var alpha = appearance.bgAlpha / 100;
			var bg = parseHex(appearance.bg);
			if (bg !== undefined) {
				style["--dshsm-bg"] = rgbaText(bg, alpha);
				style["--dshsm-bg2"] = shade(bg, 0.08, alpha);
				style["--dshsm-track"] = shade(bg, 0.28, alpha);
			} else if (appearance.bgAlpha < 100) {
				style["--dshsm-bg-alpha"] = String(appearance.bgAlpha) + "%";
			}
			var text = parseHex(appearance.text);
			if (text !== undefined) {
				style["--dshsm-fg"] = appearance.text;
				style["--dshsm-fg-2"] = rgbaText(text, 0.75);
				style["--dshsm-fg-3"] = rgbaText(text, 0.55);
			}
			// The border is the one line that has to be *seen* rather than
			// merely be a variation: a chosen colour, else a shade of the text
			// it sits against, else an edge of the panel behind it. The order
			// matters — an edge derived from the background is the fallback
			// that has to work when the text is left on the theme.
			var border = parseHex(appearance.border);
			if (border !== undefined) {
				style["--dshsm-line"] = appearance.border;
			} else if (text !== undefined) {
				style["--dshsm-line"] = rgbaText(text, 0.24);
			} else if (bg !== undefined) {
				style["--dshsm-line"] = edge(bg, 0.4, Math.max(alpha, 0.5));
			}
			var bar = parseHex(appearance.bar);
			if (bar !== undefined) {
				style["--dshsm-bar"] = rgbaText(bar, appearance.barAlpha / 100);
			} else if (appearance.barAlpha < 100) {
				style["--dshsm-bar-alpha"] = String(appearance.barAlpha) + "%";
			}
			if (appearance.blur > 0) style["--dshsm-blur"] = String(appearance.blur) + "px";
			// A face the user chose, and nothing else: an untouched panel
			// carries no font at all, so the stylesheet's `inherit` gives it
			// the page's own — the one thing two panels sitting in two corners
			// have to agree on.
			var stack = fontStack(appearance.font);
			if (stack !== "") style["--dshsm-font"] = stack;
			// The text size is a *zoom* rather than a font-size, so that every
			// size in the panel moves together: the rows, the captions and the
			// collapsed panel's total are all written against the one base size,
			// and a font-size on the panel root would move the text and leave
			// the boxes it has to sit in exactly where they were. The ratio is
			// the one number the stylesheet needs; the pixels the user chose
			// are the record's.
			if (appearance.size !== BASE_SIZE) {
				style["--dshsm-scale"] = String(appearance.size / BASE_SIZE);
			}
			return style;
		}
		/**
		* The modifier classes one appearance record asks the panel to carry.
		* Each is a class of its own because each turns on a `color-mix` the
		* panel only needs when a colour that is still a theme token has to be
		* made translucent — a declaration that cannot resolve its colour takes
		* the whole property down with it, so the untouched panel must not lean
		* on one.
		* @param appearance - a sanitized record.
		* @returns the class names to add, without any leading space.
		*/
		function panelModifiers(appearance) {
			var names = [];
			if (parseHex(appearance.bg) === undefined && appearance.bgAlpha < 100) names.push("dshsm--tinted");
			if (parseHex(appearance.bar) === undefined && appearance.barAlpha < 100) names.push("dshsm--tinted-bars");
			return names;
		}
		/**
		* Which way the panel opens when it is in its corner, which the corner
		* itself already decides: this panel is parked at the top edge, so it
		* opens downward. A panel that has been dragged picks its own way from
		* where it was put, and this is the answer for the one that was not.
		*/
		var DEFAULT_GROW_UP = false;
		/**
		* The panel's header: the part the user takes hold of, and the part a
		* position means.
		*
		* The panel is two elements. `.dshsm` is positioned with `left`/`top`/`bottom`
		* and is never scaled, so a drag can write plain screen pixels into it;
		* `.dshsm__box` is the panel that is drawn, and it is the one `zoom` is on, so
		* the text size can move everything at once. The header is the box's first
		* child, and *this* is what has to be measured — an upward-opening panel is
		* pinned by its bottom edge, so its box starts at the far end of the panel
		* and the gap between the two is the whole body.
		* @param panel - the element the root ref currently holds.
		* @returns the header element, or null where there is none to measure.
		*/
		function headerOf(panel) {
			if (panel === null || panel === undefined || panel.firstElementChild === undefined || panel.firstElementChild === null) return null;
			var box = panel.firstElementChild;
			var head = box.firstElementChild === undefined || box.firstElementChild === null ? null : box.firstElementChild;
			return head === null || typeof head.getBoundingClientRect !== "function" ? null : head;
		}
		/**
		* How tall the header is, measured from the bar the user actually holds.
		* The body can be any height under it; the header cannot change, so one
		* measurement stays good for as long as the panel is mounted. The first
		* read of it reads the box and every read after that is the value kept:
		* a render that asks the layout engine where the header is, on every
		* poll, to settle a question whose answer cannot have changed, is a panel
		* that stutters for nothing. Zero where there is no box to measure, which
		* leaves the panel anchored by its own top edge as it was before this.
		* @param root - the panel element the ref currently holds.
		* @param cache - the ref the first measurement is kept in.
		* @returns the height in pixels, or 0.
		*/
		function headerHeight(root, cache) {
			if (cache !== undefined && cache !== null && cache.current > 0) return cache.current;
			var panel = root === undefined || root === null ? null : root.current;
			var head = headerOf(panel);
			if (head === null) return 0;
			var measured = head.getBoundingClientRect().height;
			if (measured > 0 && cache !== undefined && cache !== null) cache.current = measured;
			return measured > 0 ? measured : 0;
		}
		/**
		* Whether the body opens above the header. The header is the part the
		* user put where they wanted it, so it is the part that has to stay: a
		* panel whose header is below the middle of the window opens upward into
		* the room it has, and one above the middle opens downward into its own.
		* @param anchor - the header's position, or null for the corner.
		* @param root - the panel element the ref currently holds.
		* @param cache - the ref the first measurement is kept in.
		* @returns true to open upward.
		*/
		function growsUp(anchor, root, cache) {
			if (anchor === null) return DEFAULT_GROW_UP;
			var size = viewportSize();
			if (size === undefined || !(size.height > 0)) return DEFAULT_GROW_UP;
			return anchor.y + headerHeight(root, cache) / 2 > size.height / 2;
		}
		/**
		* The window the panel may be parked in, or undefined where there is none
		* to measure — a panel with nowhere to be clamped keeps what it is given.
		* @returns the viewport, or undefined.
		*/
		function viewportSize() {
			if (typeof document !== "undefined" && document.documentElement) {
				return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
			}
			if (typeof window !== "undefined" && typeof window.innerWidth === "number") {
				return { width: window.innerWidth, height: window.innerHeight };
			}
			return undefined;
		}
		/**
		* One coordinate inside the window. The panel may hang off an edge, but
		* never so far that a corner of it is gone.
		* @param value - the coordinate.
		* @param low - the smallest it may be.
		* @param high - the largest it may be.
		* @returns the coordinate, held between the two.
		*/
		function clamp(value, low, high) {
			return Math.max(low, Math.min(high, value));
		}
		/**
		* How wide the panel is on screen, which is its own width once the
		* chosen text size is applied: a zoomed panel is laid out larger, so a
		* clamp that still measured the unscaled width would let a panel at
		* 15px be dragged so far left that its right edge went off screen.
		*
		* The clamp rounds it before it compares, so a stored position stays a
		* whole number of pixels whatever the text size is.
		* @param appearance - a sanitized record.
		* @returns the width in pixels.
		*/
		function panelWidth(appearance) {
			return PANEL_WIDTH * (appearance.size / BASE_SIZE);
		}
		/**
		* Where the panel may sit, in whole pixels: the top-left corner, which is
		* also the point a drag measures from. The panel is one width in both of
		* its shapes, so this one clamp covers both.
		* @param x - the proposed left edge.
		* @param y - the proposed top edge.
		* @param appearance - the record the panel is being drawn with.
		* @returns the position.
		*/
		function clampPosition(x, y, appearance) {
			var size = viewportSize();
			if (size === undefined) return { x: Math.round(x), y: Math.round(y) };
			return {
				x: clamp(Math.round(x), KEEP_VISIBLE - Math.round(panelWidth(appearance)), size.width - KEEP_VISIBLE),
				y: clamp(Math.round(y), KEEP_VISIBLE, size.height - KEEP_VISIBLE)
			};
		}
		/**
		* Where the panel opens: where it was left, put back inside this window,
		* because the window it was parked in is not necessarily this one.
		* @param appearance - the record the panel is opening with, which is
		* what the clamp measures the panel's width against.
		* @returns the position, or null for the corner the stylesheet draws it in.
		*/
		function loadPosition(appearance) {
			var store = storage();
			if (store === null) return null;
			try {
				var raw = JSON.parse(store.getItem(POSITION_KEY));
				if (raw === null || typeof raw !== "object") return null;
				if (typeof raw.x !== "number" || !Number.isFinite(raw.x)) return null;
				if (typeof raw.y !== "number" || !Number.isFinite(raw.y)) return null;
				return clampPosition(raw.x, raw.y, appearance);
			} catch (error) {
				return null;
			}
		}
		/**
		* Keep a position across reloads, or give the panel back its corner.
		* @param position - the position, or null to forget it.
		* @returns nothing.
		*/
		function savePosition(position) {
			var store = storage();
			if (store === null) return;
			try {
				if (position === null) store.removeItem(POSITION_KEY);
				else store.setItem(POSITION_KEY, JSON.stringify(position));
			} catch (error) {}
		}
		/**
		* A dash while the Host has not measured a value yet.
		* @returns placeholder text.
		*/
		function dash() {
			return "—";
		}
		/**
		* Human throughput at one unit precision, or a dash while the Host has
		* not measured a rate yet.
		* @param bps - bytes per second.
		* @returns formatted rate.
		*/
		function formatRate(bps) {
			if (typeof bps !== "number" || !Number.isFinite(bps)) return dash();
			var units = ["B/s", "KB/s", "MB/s", "GB/s"];
			var value = bps;
			var unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit++;
			}
			var text = unit === 0 ? value.toFixed(0) : value.toFixed(value < 10 ? 1 : 0);
			return text + " " + units[unit];
		}
		/**
		* Split a byte count into value and binary unit. Under 10 units the tenth
		* matters, above it only adds noise, so the second half of a range reads
		* `37` rather than `37.2`.
		* @param bytes - a byte count.
		* @returns the scaled value and its unit, or undefined.
		*/
		function scaleBytes(bytes) {
			if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return undefined;
			var units = ["B", "KB", "MB", "GB", "TB"];
			var value = bytes;
			var unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit++;
			}
			return { value: unit === 0 ? value.toFixed(0) : value.toFixed(value < 10 ? 1 : 0), unit: units[unit] };
		}
		/**
		* A byte count in binary units.
		* Unknown counts answer undefined so the caller can drop the clause
		* instead of printing a dangling separator.
		* @param bytes - a byte count.
		* @returns formatted size, or undefined.
		*/
		function formatBytes(bytes) {
			var scaled = scaleBytes(bytes);
			return scaled === undefined ? undefined : scaled.value + " " + scaled.unit;
		}
		/**
		* Megahertz as a clock, or a dash when the Host reported none.
		* @param mhz - nominal frequency in megahertz.
		* @returns formatted clock.
		*/
		function formatClock(mhz) {
			if (typeof mhz !== "number" || !Number.isFinite(mhz) || mhz <= 0) return undefined;
			return Math.round(mhz) + " MHz";
		}
		/**
		* A used-over-total pair that shares one unit, e.g. `37/64 GB`.
		* @param usedBytes - bytes in use.
		* @param totalBytes - bytes available in total.
		* @returns formatted pair, or undefined.
		*/
		function formatUsedOverTotal(usedBytes, totalBytes) {
			var used = scaleBytes(usedBytes);
			if (used === undefined) return undefined;
			var total = scaleBytes(totalBytes);
			return total === undefined || total.unit !== used.unit ? formatBytes(usedBytes) : used.value + "/" + total.value + " " + used.unit;
		}
		/**
		* Map a throughput onto 0..100%. Network speed has no natural full
		* scale, so a linear bar would read zero until the link is saturated.
		* A 0.35 power curve keeps a megabit visible at ~9% while still pinning
		* the top of the scale at the configured ceiling, where a plain
		* logarithm would draw a 34 KB/s trickle at more than half height.
		* @param bps - bytes per second.
		* @param fullScaleBps - the throughput that reads as 100%.
		* @returns bar percentage.
		*/
		function throughputPercent(bps, fullScaleBps) {
			if (typeof bps !== "number" || !Number.isFinite(bps) || bps <= 0) return 0;
			var full = typeof fullScaleBps === "number" && fullScaleBps > 0 ? fullScaleBps : 104857600;
			var percent = Math.pow(bps / full, 0.35) * 100;
			return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
		}
		/**
		* Join the two figures of a row: the percentage the bar stands for, and
		* whatever else the same source reported. A missing second figure is
		* dropped rather than rendered as a dangling separator.
		* @param percent - the bar percentage.
		* @param secondary - the trailing figure.
		* @returns the right-hand text.
		*/
		function pairValue(percent, secondary) {
			var primary = typeof percent === "number" && Number.isFinite(percent) ? Math.round(percent) + "%" : dash();
			return secondary === undefined || secondary === null ? primary : primary + " · " + secondary;
		}
		/**
		* Append one `label: value` clause to a tooltip, skipping it when the
		* Host reported no value.
		* @param parts - clauses collected so far.
		* @param label - clause label.
		* @param value - already formatted clause value.
		* @returns nothing; the array is appended in place.
		*/
		function clause(parts, label, value) {
			if (value === undefined || value === null || value === dash()) return;
			parts.push(label + ": " + value);
		}
		/**
		* One labelled metric row: short caption, progress bar, and the figures
		* the bar stands for, right-aligned. The caption stays terse so six rows
		* fit the overlay; the row's own tooltip carries the full name. A row
		* the collapsed panel draws carries the same bar in narrower
		* proportions, and only the figure that fits beside it.
		* @param props - label, tooltip, percentage, value text, colour, and
		* whether this is the collapsed panel's row.
		* @returns the row element.
		*/
		function MetricRow(props) {
			var measured = typeof props.percent === "number" && Number.isFinite(props.percent);
			var percent = measured ? Math.max(0, Math.min(100, props.percent)) : 0;
			var width = Math.round(percent * 10) / 10;
			return h("div", {
				className: props.compact === true ? "dshsm__row dshsm__row--mini" : "dshsm__row",
				title: props.hint
			}, h("span", { className: "dshsm__label" }, props.label), h("span", {
				className: "dshsm__track",
				role: "progressbar",
				"aria-label": props.name ?? props.label,
				"aria-valuemin": 0,
				"aria-valuemax": 100,
				"aria-valuenow": measured ? Math.round(percent) : undefined,
				"aria-valuetext": props.value
			}, h("span", {
				className: "dshsm__fill",
				// The row's own colour is handed to the stylesheet as a custom
				// property rather than as `background`, so a chosen bar colour
				// set once on the panel can override all six rows at once.
				style: {
					width: width + "%",
					"--dshsm-row": props.color
				}
			})), h("span", { className: "dshsm__value" }, props.value));
		}
		/**
		* The appearance block behind the header's gear. Every control writes one
		* field of the panel's record and the panel repaints behind it, so a
		* colour is judged where it will be used. A colour row also carries the
		* button that hands the field back to the theme, which keeps "custom"
		* a state the user can always leave.
		* @param props - translator, the current record, the field writer, and the reset.
		* @returns the settings element.
		*/
		function SettingsPanel(props) {
			var t = props.t;
			var appearance = props.appearance;
			/**
			* One colour row: caption, the native colour input, and the button
			* that returns the field to the theme token. A field that already
			* follows the theme shows the token's own colour at half strength,
			* which says the colour is on loan rather than in use.
			* @param field - "bg", "text", "border" or "bar".
			* @param label - the caption.
			* @returns the row element.
			*/
			var colorRow = function (field, label) {
				var value = appearance[field];
				return h("div", { className: "dshsm__set" }, h("span", { className: "dshsm__set-name" }, label), h("input", {
					type: "color",
					className: value === "" ? "dshsm__set-color dshsm__set-color--theme" : "dshsm__set-color",
					value: value === "" ? swatchFor(field) : value,
					"aria-label": label,
					title: value === "" ? t("set.theme") : label,
					onChange: function (event) {
						props.write(field, event.target.value);
					}
				}), h("button", {
					type: "button",
					className: "dshsm__set-theme",
					title: t("set.theme"),
					"aria-label": t("set.theme") + " · " + label,
					disabled: value === "",
					onClick: function () {
						props.write(field, "");
					}
				}, "⟲"));
			};
			/**
			* One slider row: caption, the range input, and the number it now
			* holds, so the value is readable without hovering anything.
			* @param field - a numeric field of the record.
			* @param label - the caption.
			* @param unit - what the number counts in.
			* @returns the row element.
			*/
			var rangeRow = function (field, label, unit) {
				return h("div", { className: "dshsm__set" }, h("span", { className: "dshsm__set-name" }, label), h("input", {
					type: "range",
					className: "dshsm__set-range",
					min: APPEARANCE_RANGE[field][0],
					max: APPEARANCE_RANGE[field][1],
					step: 1,
					value: appearance[field],
					"aria-label": label,
					onChange: function (event) {
						props.write(field, Number(event.target.value));
					}
				}), h("span", { className: "dshsm__set-num" }, appearance[field] + unit));
			};
			/**
			* One menu row: caption, and a menu of the choices the panel knows.
			* The two menus the panel has — a face, a size — are the same shape,
			* a list the panel looks its answer up in, so they share this row.
			* Neither carries a ⟲ of its own: a menu can say "none of these" by
			* itself, and the reset at the foot of the block is what hands the
			* whole record back, so a row with a second way out would be saying
			* the menu cannot be trusted.
			* @param label - the caption.
			* @param field - the field of the record this menu writes.
			* @param entries - one { value, text } per choice, in the order shown.
			* @param asValue - how a menu value becomes a record value; a menu
			* only ever hands back a string, and a record holds a number.
			* @returns the row element.
			*/
			var menuRow = function (label, field, entries, asValue) {
				return h("div", { className: "dshsm__set" }, h("span", { className: "dshsm__set-name" }, label), h("select", {
					className: "dshsm__set-menu",
					value: appearance[field],
					"aria-label": label,
					title: label,
					onChange: function (event) {
						props.write(field, asValue(event.target.value));
					}
				}, entries.map(function (entry) {
					return h("option", { key: entry.value, value: entry.value }, entry.text);
				})));
			};
			/**
			* The face row: the page's own face first, then one entry per stack.
			* @param label - the caption.
			* @returns the row element.
			*/
			var fontRow = function (label) {
				return menuRow(label, "font", FONT_STACKS.map(function (entry) {
					return { value: entry.key, text: t(entry.label) };
				}), function (value) {
					return value;
				});
			};
			/**
			* The size row: the sizes on offer, in the pixels they are.
			* @param label - the caption.
			* @returns the row element.
			*/
			var sizeRow = function (label) {
				return menuRow(label, "size", TEXT_SIZES.map(function (size) {
					return { value: size, text: size + "px" };
				}), Number);
			};
			return h("div", { className: "dshsm__settings", role: "group", "aria-label": t("panel.settings") }, colorRow("bg", t("set.bg")), rangeRow("bgAlpha", t("set.bgAlpha"), "%"), colorRow("text", t("set.text")), colorRow("border", t("set.border")), colorRow("bar", t("set.bar")), rangeRow("barAlpha", t("set.barAlpha"), "%"), rangeRow("blur", t("set.blur"), "px"), fontRow(t("set.font")), sizeRow(t("set.size")), h("button", {
				type: "button",
				className: "dshsm__set-reset",
				disabled: isDefaultAppearance(appearance),
				onClick: props.reset
			}, t("set.reset")));
		}
		/**
		* The overlay panel. It owns one in-flight poll at a time, keeps the last
		* good sample visible while a poll fails, and skips polling entirely
		* while the page is hidden so a backgrounded tab costs nothing.
		* @param props - bound translator for this plugin's namespace.
		* @returns the panel element.
		*/
		function MonitorPanel(props) {
			var t = props.t;
			var open = react.useState(true);
			var state = react.useState({ data: null, error: null });
			var settingsState = react.useState(false);
			var appearanceState = react.useState(loadAppearance);
			// The position is read against the size it will be drawn at, so the
			// record has to be read first: a panel left parked at the left edge
			// at 11px keeps its corner at 15px, one that does not is dragged
			// further off screen every time the size changes.
			var positionState = react.useState(function () {
				return loadPosition(appearanceState[0]);
			});
			var rootRef = react.useRef(null);
			var headSize = react.useRef(0);
			var dragRef = react.useRef(null);
			var expanded = open[0];
			var setExpanded = open[1];
			var sample = state[0];
			var setSample = state[1];
			var settingsOpen = settingsState[0];
			var setSettingsOpen = settingsState[1];
			var appearance = appearanceState[0];
			var setAppearance = appearanceState[1];
			var position = positionState[0];
			var setPosition = positionState[1];
			/**
			* Write one field of the appearance record. Records are small and
			* replaced whole, so a functional update keeps two controls from
			* writing over each other when they are used in the same tick.
			* @param field - the field to write.
			* @param value - the value to store.
			* @returns nothing.
			*/
			var writeAppearance = function (field, value) {
				setAppearance(function (previous) {
					var next = {};
					var name;
					for (name in previous) next[name] = previous[name];
					next[field] = value;
					return next;
				});
			};
			react.useEffect(function () {
				saveAppearance(appearance);
			}, [appearance]);
			// The header's height is measured once and kept, because a body that
			// grows with its data must not move the panel on every poll. The one
			// thing that does change the header is the text size, so that is the
			// one thing that drops the measurement.
			react.useEffect(function () {
				headSize.current = 0;
			}, [appearance.size]);
			react.useEffect(function () {
				savePosition(position);
			}, [position]);
			/**
			* Follow the pointer. The panel moves through its own style rather than
			* through a re-render: this runs on every pointermove, and a state
			* update that often would rebuild six rows to shift a box.
			* @param event - the pointer event.
			* @returns nothing.
			*/
			var onDragMove = function (event) {
				if (dragRef.current === null || event.pointerId !== dragRef.current.pointerId) return;
				var next = clampPosition(event.clientX - dragRef.current.dx, event.clientY - dragRef.current.dy, appearance);
				dragRef.current.x = next.x;
				dragRef.current.y = next.y;
				dragRef.current.moved = true;
				var panel = rootRef.current;
				if (panel === null || panel.style === undefined) return;
				panel.style.left = next.x + "px";
				// Which way it opens can change mid-drag, since that is the
				// whole point of a panel that opens into the room it has. The
				// edge it is pinned by changes with it, so a header held at
				// the pointer does not jump by its own body's height.
				var size = viewportSize();
				if (size !== undefined && next.y + headerHeight(rootRef, headSize) / 2 > size.height / 2) {
					panel.classList.add("dshsm--up");
					panel.style.bottom = Math.max(0, size.height - next.y - headerHeight(rootRef, headSize)) + "px";
					panel.style.top = "auto";
				} else {
					panel.classList.remove("dshsm--up");
					panel.style.top = next.y + "px";
					panel.style.bottom = "auto";
				}
				if (panel.classList !== undefined) panel.classList.add("dshsm--placed", "dshsm--dragging");
			};
			/**
			* Let go. The position the drag ended on is the one to keep: it is what
			* the element was already painted with, so committing it repaints
			* nothing and only puts it in storage. A press and release that never
			* moved is still the end of a drag — the handle has to be handed back
			* either way, or the next gesture would inherit this one.
			* @returns nothing.
			*/
			var endDrag = function () {
				if (dragRef.current === null) return;
				var landed = { x: dragRef.current.x, y: dragRef.current.y };
				var moved = dragRef.current.moved;
				dragRef.current = null;
				var panel = rootRef.current;
				if (panel !== null && panel.classList !== undefined) panel.classList.remove("dshsm--dragging");
				if (moved) setPosition(landed);
			};
			/**
			* Take hold of the panel by its header. The pointer keeps its offset
			* inside the panel, so the header does not jump up to meet the cursor;
			* with no measured box there is no offset to speak of, and the panel
			* follows the cursor outright. A press always takes hold, even one
			* that arrives while a drag is somehow still open: a release the
			* window never saw must not leave the panel stuck to a grip that
			* nobody is holding.
			* @param event - the pointer event that took hold.
			* @returns nothing.
			*/
			var beginDrag = function (event) {
				if (event.button !== 0) return;
				var panel = rootRef.current;
				var head = headerOf(panel);
				var box = head === null ? undefined : head.getBoundingClientRect();
				// The panel is the header's parent, so it answers with the same
				// left edge and a top that the body's height may have moved.
				// It is the fallback, not the measure: a panel with no readable
				// header still follows the cursor.
				if (box === undefined && panel !== null && typeof panel.getBoundingClientRect === "function") {
					box = panel.getBoundingClientRect();
				}
				dragRef.current = {
					pointerId: event.pointerId,
					// The header is what the pointer took hold of and what the
					// position means, so the offset is measured from the header.
					// Measuring from the panel instead would let the grab
					// point slide by the body's height every time a drag began.
					dx: box === undefined ? 0 : event.clientX - box.left,
					dy: box === undefined ? 0 : event.clientY - box.top,
					x: position === null ? 0 : position.x,
					y: position === null ? 0 : position.y,
					moved: false
				};
				if (panel !== null && panel.classList !== undefined) panel.classList.add("dshsm--dragging");
			};
			react.useEffect(function () {
				// The drag outlives the render that started it — a sample can
				// land halfway through one — so the move and release are heard
				// here, once, and decide for themselves whether a drag is on.
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
				window.addEventListener("pointermove", onDragMove);
				window.addEventListener("pointerup", endDrag);
				window.addEventListener("pointercancel", endDrag);
				// A release over the menu bar, or anywhere else the window stops
				// hearing about, arrives as a blur rather than as an event.
				window.addEventListener("blur", endDrag);
				return function () {
					window.removeEventListener("pointermove", onDragMove);
					window.removeEventListener("pointerup", endDrag);
					window.removeEventListener("pointercancel", endDrag);
					window.removeEventListener("blur", endDrag);
				};
			}, []);
			react.useEffect(function () {
				if (!settingsOpen) return;
				if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
				var dismiss = function (event) {
					var root = rootRef.current;
					if (root && typeof root.contains === "function" && event.target && root.contains(event.target)) return;
					if (event.type === "keydown" && event.key !== "Escape") return;
					setSettingsOpen(false);
				};
				document.addEventListener("pointerdown", dismiss, true);
				document.addEventListener("keydown", dismiss, true);
				return function () {
					document.removeEventListener("pointerdown", dismiss, true);
					document.removeEventListener("keydown", dismiss, true);
				};
			}, [settingsOpen]);
			react.useEffect(function () {
				var inFlight = false;
				var disposed = false;
				var controller = new AbortController();
				var tick = function () {
					if (inFlight || disposed) return;
					if (typeof document !== "undefined" && document.hidden) return;
					inFlight = true;
					fetch(SAMPLE_ROUTE, {
						signal: controller.signal,
						cache: "no-store",
						headers: { accept: "application/json" }
					}).then(function (response) {
						if (!response.ok) throw new Error("HTTP " + response.status);
						return response.json();
					}).then(function (data) {
						if (disposed) return;
						setSample({ data: data, error: null });
					}).catch(function (error) {
						if (disposed || controller.signal.aborted) return;
						setSample(function (previous) {
							return { data: previous.data, error: error instanceof Error ? error.message : String(error) };
						});
					}).finally(function () {
						inFlight = false;
					});
				};
				tick();
				var timer = setInterval(tick, POLL_INTERVAL_MS);
				return function () {
					disposed = true;
					controller.abort();
					clearInterval(timer);
				};
			}, []);
			var data = sample.data;
			var cpu = data && data.cpu ? data.cpu : {};
			var clock = data && data.clock ? data.clock : {};
			var mem = data && data.mem ? data.mem : {};
			var gpu = data && data.gpu ? data.gpu : {};
			var net = data && data.net ? data.net : {};
			var fullScale = net.fullScaleBps;
			var down = typeof net.down === "number" ? net.down : undefined;
			var up = typeof net.up === "number" ? net.up : undefined;
			var loadAverage = (cpu.loadAverage || []).join(" ");
			var number = function (value) {
				return typeof value === "number" && Number.isFinite(value) ? value : undefined;
			};
			var rows = [];
			/**
			* The whole socket as one row: what the panel draws when the machine
			* publishes no perf-level split, and what the collapsed panel draws
			* either way, since a short track has room for one CPU figure and not
			* for one per level.
			* @param hint - the tooltip clauses, already collected.
			* @param compact - draw it in the collapsed panel's proportions.
			* @returns the row element.
			*/
			var overallRow = function (hint, compact) {
				return {
					label: t("row.cpu"),
					name: t("row.cpu"),
					hint: hint.join(" · "),
					percent: cpu.overall,
					value: pairValue(cpu.overall, undefined),
					color: "var(--dsw-alias-brand-primary)",
					compact: compact
				};
			};
			/**
			* One row per perf level. The Host groups the cores and names each
			* level from macOS itself, so the caption is one letter and the
			* tooltip spells the level out.
			* @param tier - one entry of `cpu.tiers`.
			* @returns nothing; the row is appended in place.
			*/
			var addTierRow = function (tier) {
				var clock = number(tier.mhz);
				var hint = [tier.name];
				clause(hint, t("hint.cores"), String(tier.cores ?? dash()));
				var clockText = formatClock(clock);
				clause(hint, tier.live === true || clock === undefined ? t("hint.clock") : t("hint.nominalClock"), clock === undefined ? t("hint.noClock") : clockText);
				clause(hint, t("hint.load"), loadAverage === "" ? undefined : loadAverage);
				rows.push({
					label: tier.label ?? t("row.cpu"),
					name: tier.name ?? t("row.cpu"),
					hint: hint.join(" · "),
					percent: tier.percent,
					value: pairValue(tier.percent, clockText),
					color: "var(--dsw-alias-brand-primary)"
				});
			};
			var tiers = Array.isArray(cpu.tiers) ? cpu.tiers : [];
			if (tiers.length > 0) {
				for (var index = 0; index < tiers.length; index++) addTierRow(tiers[index]);
			} else {
				// No published split: draw the whole socket as one row rather
				// than inventing a division the machine never reported.
				var cpuHint = [t("row.cpu"), t("hint.cores") + ": " + (data?.cores ?? dash())];
				clause(cpuHint, t("hint.load"), loadAverage === "" ? undefined : loadAverage);
				cpuHint.splice(1, 0, t("hint.splitUnavailable"));
				rows.push(overallRow(cpuHint, false));
			}
			var memHint = [t("row.mem"), t("hint.memUsed") + ": " + (formatUsedOverTotal(mem.usedBytes, mem.totalBytes) ?? dash())];
			clause(memHint, t("hint.compressed"), formatBytes(number(mem.compressedBytes)));
			if (number(mem.swapUsedBytes) !== undefined) memHint.push(t("hint.swap") + ": " + formatUsedOverTotal(mem.swapUsedBytes, mem.swapTotalBytes));
			/**
			* One memory row, from the same figures in either panel: the expanded
			* one has room for the used-over-total beside the percentage, the
			* collapsed one only for the percentage, and the tooltip is the same.
			* @param value - the text that stands for the row.
			* @param compact - draw it in the collapsed panel's proportions.
			* @returns the row element.
			*/
			var memoryRow = function (value, compact) {
				return {
					label: t("row.mem"),
					name: t("row.mem"),
					hint: memHint.join(" · "),
					percent: mem.available === false ? undefined : mem.percent,
					value: value,
					color: "var(--dsw-alias-state-warn-primary)",
					compact: compact
				};
			};
			rows.push(memoryRow(mem.available === false ? dash() : pairValue(mem.percent, formatUsedOverTotal(mem.usedBytes, mem.totalBytes)), false));
			var gpuHint = gpu.available === false ? [t("row.gpu"), t("hint.gpuUnavailable")] : [gpu.name || t("row.gpu")];
			clause(gpuHint, t("hint.cores"), typeof gpu.cores === "number" ? String(gpu.cores) : undefined);
			clause(gpuHint, t("hint.gpuMemory"), formatBytes(number(gpu.memoryBytes)));
			clause(gpuHint, t("hint.renderer"), typeof gpu.rendererPercent === "number" ? gpu.rendererPercent + "%" : undefined);
			clause(gpuHint, t("hint.tiler"), typeof gpu.tilerPercent === "number" ? gpu.tilerPercent + "%" : undefined);
			var gpuClock = formatClock(number(gpu.mhz));
			clause(gpuHint, t("hint.clock"), gpuClock);
			rows.push({
				label: t("row.gpu"),
				name: gpu.name || t("row.gpu"),
				hint: gpuHint.join(" · "),
				percent: gpu.available === true ? gpu.percent : undefined,
				value: gpu.available === true ? pairValue(gpu.percent, gpuClock ?? formatBytes(number(gpu.memoryBytes))) : dash(),
				color: "var(--dsw-alias-state-success-primary)"
			});
			/**
			* One throughput row. The caption is the bare arrow, so the pair of
			* arrows reads at a glance; the direction's name is one hover away.
			* @param key - row key ("row.down" or "row.up").
			* @param arrow - caption glyph.
			* @param bps - measured rate.
			* @param color - fill colour.
			* @returns nothing; the row is appended in place.
			*/
			var addNetRow = function (key, arrow, bps, color) {
				var hint = [t(key)];
				if (typeof bps === "number" && Number.isFinite(bps)) hint.push(formatRate(bps));
				if (typeof net.interfaces === "number" && net.interfaces > 0) hint.push(net.interfaces + " " + t("hint.interfaces"));
				clause(hint, t("hint.fullScale"), formatRate(fullScale));
				rows.push({
					label: arrow,
					name: t(key),
					hint: hint.join(" · "),
					percent: throughputPercent(bps, fullScale),
					value: formatRate(bps),
					color: color
				});
			};
			addNetRow("row.down", "↓", down, "var(--dsw-alias-brand-primary)");
			addNetRow("row.up", "↑", up, "var(--dsw-alias-state-warn-primary)");
			// Collapsed, the panel keeps the two figures worth a glance — the
			// socket's busy share and memory in use — and drops the rest. They
			// share the one line the box has left, which is why each of them
			// gives up room: a short caption, and the percentage alone. The split
			// that share is made of is one hover away, spelled out the same way
			// the perf-level rows spell their own name.
			var miniCpuHint = [t("row.cpu"), t("hint.cores") + ": " + (data?.cores ?? dash())];
			clause(miniCpuHint, t("hint.levels"), tiers.length === 0 ? undefined : tiers.map(function (tier) {
				return (tier.label ?? t("row.cpu")) + " " + (number(tier.percent) === undefined ? dash() : Math.round(tier.percent) + "%");
			}).join(" · "));
			clause(miniCpuHint, t("hint.load"), loadAverage === "" ? undefined : loadAverage);
			if (tiers.length === 0) miniCpuHint.splice(1, 0, t("hint.splitUnavailable"));
			var mini = [
				overallRow(miniCpuHint, true),
				memoryRow(mem.available === false ? dash() : pairValue(mem.percent, undefined), true)
			];
			// Say why the clocks are nominal instead of leaving a number that
			// never changes to explain itself. A panel with no per-tier row has
			// no clock to explain — it draws the whole processor as one row and
			// says nothing about frequency — and a collapsed panel shows no
			// clocks either, so both stay quiet.
			var nominalTier = tiers.length > 0 && tiers.some(function (tier) {
				return tier.live !== true;
			});
			var clockNote = clock.available === true || clock.reason === "sampler idle" || nominalTier === false ? null : t("hint.clockFallback") + (clock.reason === undefined ? "" : " · " + clock.reason);
			// A panel nobody has moved keeps the corner the stylesheet draws it
			// in, with no inline position to contradict it.
			var style = panelStyle(appearance);
			// The stored position is the header's place, not the panel's: the
			// header is the thing the user moved, and it must not slide when
			// the body opens. An upward-opening panel is therefore anchored by
			// its bottom edge, so that edge — where the header is — stays put
			// while the body grows away from the middle of the window.
			var up = growsUp(position, rootRef, headSize);
			var placed = position === null ? [] : ["dshsm--placed"];
			if (up) placed = placed.concat(["dshsm--up"]);
			if (position !== null) {
				style.left = position.x + "px";
				var size = viewportSize();
				if (up && size !== undefined) {
					style.bottom = Math.max(0, size.height - position.y - headerHeight(rootRef, headSize)) + "px";
					style.top = "auto";
				} else {
					style.top = position.y + "px";
				}
			}
			return h("aside", {
				className: ["dshsm"].concat(sample.error === null ? [] : ["dshsm--error"], panelModifiers(appearance), placed, expanded ? [] : ["dshsm--mini"]).join(" "),
				ref: rootRef,
				style: style,
				"aria-label": t("panel.title")
			}, h("div", { className: "dshsm__box" }, h("header", { className: "dshsm__head" }, h("span", {
				className: "dshsm__title",
				title: t("panel.drag"),
				onPointerDown: beginDrag,
				// Two clicks in the same spot is a deliberate act, not a drag
				// that went nowhere, so it is what sends the panel home.
				onDoubleClick: function () {
					setPosition(null);
				}
			}, t("panel.title")), expanded ? null : h("div", { className: "dshsm__mini" }, mini.map(function (row) {
				return h(MetricRow, row);
			})), h("button", {
				type: "button",
				className: settingsOpen ? "dshsm__toggle dshsm__gear dshsm__toggle--on" : "dshsm__toggle dshsm__gear",
				"aria-expanded": settingsOpen,
				"aria-label": t("panel.settings"),
				title: t("panel.settings"),
				// The settings live in the body, so opening them from a
				// collapsed panel has to open the panel as well.
				onClick: function () {
					if (!expanded) {
						setExpanded(true);
						setSettingsOpen(true);
						return;
					}
					setSettingsOpen(!settingsOpen);
				}
			}, "⚙"), h("button", {
				type: "button",
				// The arrow is one glyph turned to point at the body: down for a
				// panel that opens downward, up for one that opens upward, so
				// the button says which way the panel will go before it is
				// pressed. Turning it is the animation; swapping ▾ for ▸ was
				// not one.
				className: expanded ? "dshsm__toggle dshsm__fold dshsm__fold--open" : "dshsm__toggle dshsm__fold",
				"aria-expanded": expanded,
				"aria-label": expanded ? t("panel.collapse") : t("panel.expand"),
				title: expanded ? t("panel.collapse") : t("panel.expand"),
				onClick: function () {
					setExpanded(!expanded);
				}
			})), expanded ? h("div", {
				className: "dshsm__rows"
			}, rows.map(function (row) {
				return h(MetricRow, row);
			}), settingsOpen ? h(SettingsPanel, {
				t: t,
				appearance: appearance,
				write: writeAppearance,
				reset: function () {
					setAppearance(sanitizeAppearance(null));
				}
			}) : null) : null, expanded && clockNote !== null ? h("div", {
				className: "dshsm__note"
			}, clockNote) : null, sample.error === null ? null : h("div", {
				className: "dshsm__foot",
				title: sample.error
			}, t("hint.offline"))));
		}
		/** Client services this half needs: the slot registry and dictionaries. */
		var inject = ["slots", "locale"];
		/**
		* Client plugin body: publish the dictionaries and mount one overlay row.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "sys-monitor: dictionaries");
			var t = ctx.locale.bind(NS);
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "sys-monitor.panel",
				order: 200,
				locale: NS
			}, function MonitorPanelEntry() {
				return h(MonitorPanel, { t });
			}));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
