import type { MinimapSettings } from "./settings";
import type { BBox, Canvas, CanvasNode } from "./types";

// Obsidian canvas preset color ids -> approximate hex.
const PRESET_COLORS: Record<string, string> = {
	"1": "#fb464c",
	"2": "#e9973f",
	"3": "#e0de71",
	"4": "#44cf6e",
	"5": "#53dfdd",
	"6": "#a882ff",
};

const NODE_DEFAULT_COLOR = "#7a7a8c";
const VIEWPORT_STROKE = "#ffffff";
const BG_COLOR = "rgba(20, 20, 28, 0.72)";

// Inner padding (fraction of content) so nodes/viewport never touch the edge.
const WORLD_PADDING = 0.04;

// Custom double-click detection (the native dblclick is tied to the OS speed,
// which feels sluggish here). Two clicks within this window and pixel slop
// count as a double-click.
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_SLOP = 6;

// Pixel clamp for the proportional box size, and a fallback before the canvas
// view has been laid out (clientWidth/Height still 0).
const SIZE_MIN_PX = 160;
const SIZE_MAX_PX = 320;
const SIZE_FALLBACK_PX = 200;

function nodeColor(color?: string): string {
	if (!color) return NODE_DEFAULT_COLOR;
	if (color.startsWith("#")) return color;
	return PRESET_COLORS[color] ?? NODE_DEFAULT_COLOR;
}

/**
 * One minimap instance bound to a single Canvas view. Owns its DOM, a
 * requestAnimationFrame redraw loop, and pointer-driven navigation.
 */
export class Minimap {
	private containerEl: HTMLDivElement;
	private canvasEl: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	// Document/window that own the canvas view, so we stay correct in popout windows.
	private readonly win: Window;

	private rafHandle: number | null = null;
	private lastSig = "";
	private dragging = false;

	// Timestamp/position of the last click, for custom double-click detection.
	private lastClickAt = 0;
	private lastClickX = 0;
	private lastClickY = 0;

	// world -> minimap (CSS px) transform, recomputed each draw and reused for hit-testing.
	private world: BBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	private scale = 1;
	private offsetX = 0;
	private offsetY = 0;
	private cssW = 0;
	private cssH = 0;

	constructor(
		private canvas: Canvas,
		private settings: MinimapSettings,
	) {
		const doc = this.canvas.wrapperEl.ownerDocument;
		this.win = doc.defaultView ?? window;

		this.containerEl = doc.createElement("div");
		this.containerEl.addClass("canvas-minimap");

		this.canvasEl = doc.createElement("canvas");
		this.containerEl.appendChild(this.canvasEl);
		this.ctx = this.canvasEl.getContext("2d") as CanvasRenderingContext2D;

		this.canvas.wrapperEl.appendChild(this.containerEl);
		this.applyPosition();

		this.canvasEl.addEventListener("pointerdown", this.onPointerDown);
		this.win.addEventListener("pointermove", this.onPointerMove);
		this.win.addEventListener("pointerup", this.onPointerUp);

		this.rafHandle = this.win.requestAnimationFrame(this.loop);
	}

	updateSettings(settings: MinimapSettings): void {
		this.settings = settings;
		this.applyPosition();
		this.lastSig = ""; // force redraw/relayout
	}

	destroy(): void {
		if (this.rafHandle !== null) this.win.cancelAnimationFrame(this.rafHandle);
		this.rafHandle = null;
		this.canvasEl.removeEventListener("pointerdown", this.onPointerDown);
		this.win.removeEventListener("pointermove", this.onPointerMove);
		this.win.removeEventListener("pointerup", this.onPointerUp);
		this.containerEl.remove();
	}

	private applyPosition(): void {
		this.containerEl.toggleClass("is-left", this.settings.position === "bottom-left");
		this.containerEl.toggleClass("is-right", this.settings.position === "bottom-right");
	}

	// --- redraw loop ---------------------------------------------------------

	private loop = (): void => {
		this.rafHandle = this.win.requestAnimationFrame(this.loop);
		const sig = this.signature();
		if (sig === this.lastSig) return;
		this.lastSig = sig;
		this.draw();
	};

	/** Cheap fingerprint of everything that affects the rendered image. */
	private signature(): string {
		let hash = 0;
		for (const n of this.canvas.nodes.values()) {
			hash = (hash + n.x + n.y + n.width + n.height) | 0;
		}
		const vp = this.viewportBBox();
		const vpSig = vp ? `${vp.minX | 0},${vp.minY | 0},${vp.maxX | 0},${vp.maxY | 0}` : "x";
		return `${this.canvas.nodes.size}:${hash}:${vpSig}:${this.boxSize()}:${this.settings.position}`;
	}

	/** Square side in px: a fraction of the view's shorter side, pixel-clamped. */
	private boxSize(): number {
		const el = this.canvas.wrapperEl;
		const shorter = Math.min(el.clientWidth || 0, el.clientHeight || 0);
		if (shorter <= 0) return SIZE_FALLBACK_PX;
		const raw = shorter * this.settings.sizeRatio;
		return Math.round(Math.max(SIZE_MIN_PX, Math.min(SIZE_MAX_PX, raw)));
	}

	private viewportBBox(): BBox | null {
		try {
			return this.canvas.getViewportBBox?.() ?? null;
		} catch {
			return null;
		}
	}

	private nodesBBox(): BBox | null {
		const it = this.canvas.nodes.values();
		const first = it.next();
		if (first.done) return null;
		const n0 = first.value;
		const bbox: BBox = {
			minX: n0.x,
			minY: n0.y,
			maxX: n0.x + n0.width,
			maxY: n0.y + n0.height,
		};
		for (const n of it) {
			bbox.minX = Math.min(bbox.minX, n.x);
			bbox.minY = Math.min(bbox.minY, n.y);
			bbox.maxX = Math.max(bbox.maxX, n.x + n.width);
			bbox.maxY = Math.max(bbox.maxY, n.y + n.height);
		}
		return bbox;
	}

	private draw(): void {
		const nodesBox = this.nodesBBox();
		const vp = this.viewportBBox();

		// Obsidian's canvas is infinite; the minimap should frame only the
		// region content actually occupies. So the world is the node bounding
		// box alone — the viewport rectangle is drawn on top and simply clips
		// when you pan/zoom out past the content.
		if (!nodesBox) {
			this.containerEl.toggleClass("is-hidden", true);
			return;
		}
		this.containerEl.toggleClass("is-hidden", false);

		let world = nodesBox;
		let w = Math.max(1, world.maxX - world.minX);
		let h = Math.max(1, world.maxY - world.minY);
		const padX = w * WORLD_PADDING;
		const padY = h * WORLD_PADDING;
		world = {
			minX: world.minX - padX,
			minY: world.minY - padY,
			maxX: world.maxX + padX,
			maxY: world.maxY + padY,
		};
		w = world.maxX - world.minX;
		h = world.maxY - world.minY;
		this.world = world;

		// Square box sized as a fraction of the canvas view's shorter side,
		// clamped to a sensible pixel range so it scales with the window/monitor
		// without getting absurd. Content is fit inside and centered, preserving
		// the canvas aspect ratio (letterboxed top/bottom or left/right).
		const box = this.boxSize();
		const cssW = box;
		const cssH = box;
		this.scale = Math.min(box / w, box / h);
		this.offsetX = (box - w * this.scale) / 2;
		this.offsetY = (box - h * this.scale) / 2;

		this.resizeCanvas(cssW, cssH);

		const ctx = this.ctx;
		ctx.clearRect(0, 0, cssW, cssH);
		ctx.fillStyle = BG_COLOR;
		ctx.fillRect(0, 0, cssW, cssH);

		for (const n of this.canvas.nodes.values()) {
			const x = this.offsetX + (n.x - world.minX) * this.scale;
			const y = this.offsetY + (n.y - world.minY) * this.scale;
			const nw = Math.max(1, n.width * this.scale);
			const nh = Math.max(1, n.height * this.scale);
			ctx.fillStyle = nodeColor(n.color);
			ctx.fillRect(x, y, nw, nh);
		}

		if (vp) {
			const x = this.offsetX + (vp.minX - world.minX) * this.scale;
			const y = this.offsetY + (vp.minY - world.minY) * this.scale;
			const vw = (vp.maxX - vp.minX) * this.scale;
			const vh = (vp.maxY - vp.minY) * this.scale;
			ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
			ctx.fillRect(x, y, vw, vh);
			ctx.strokeStyle = VIEWPORT_STROKE;
			ctx.lineWidth = 1.5;
			ctx.strokeRect(x + 0.75, y + 0.75, vw - 1.5, vh - 1.5);
		}
	}

	private resizeCanvas(cssW: number, cssH: number): void {
		const dpr = this.win.devicePixelRatio || 1;
		if (this.cssW !== cssW || this.cssH !== cssH) {
			this.cssW = cssW;
			this.cssH = cssH;
			this.containerEl.setCssStyles({ width: `${cssW}px`, height: `${cssH}px` });
			this.canvasEl.setCssStyles({ width: `${cssW}px`, height: `${cssH}px` });
		}
		const pxW = Math.round(cssW * dpr);
		const pxH = Math.round(cssH * dpr);
		if (this.canvasEl.width !== pxW || this.canvasEl.height !== pxH) {
			this.canvasEl.width = pxW;
			this.canvasEl.height = pxH;
		}
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	// --- navigation ----------------------------------------------------------

	private onPointerDown = (evt: PointerEvent): void => {
		evt.preventDefault();
		evt.stopPropagation();

		const now = performance.now();
		const isDouble =
			now - this.lastClickAt < DOUBLE_CLICK_MS &&
			Math.abs(evt.clientX - this.lastClickX) < DOUBLE_CLICK_SLOP &&
			Math.abs(evt.clientY - this.lastClickY) < DOUBLE_CLICK_SLOP;
		if (isDouble) {
			this.lastClickAt = 0; // consume, so a third click doesn't re-trigger
			this.zoomToNearest(evt);
			return;
		}
		this.lastClickAt = now;
		this.lastClickX = evt.clientX;
		this.lastClickY = evt.clientY;

		this.dragging = true;
		this.canvasEl.setPointerCapture?.(evt.pointerId);
		this.navigateTo(evt);
	};

	private onPointerMove = (evt: PointerEvent): void => {
		if (!this.dragging) return;
		evt.preventDefault();
		this.navigateTo(evt);
	};

	private onPointerUp = (evt: PointerEvent): void => {
		if (!this.dragging) return;
		this.dragging = false;
		this.canvasEl.releasePointerCapture?.(evt.pointerId);
	};

	/** Translate a pointer position over the minimap into world coordinates. */
	private eventToWorld(evt: PointerEvent | MouseEvent): { wx: number; wy: number } {
		const rect = this.canvasEl.getBoundingClientRect();
		const mx = evt.clientX - rect.left;
		const my = evt.clientY - rect.top;
		return {
			wx: (mx - this.offsetX) / this.scale + this.world.minX,
			wy: (my - this.offsetY) / this.scale + this.world.minY,
		};
	}

	/** Pan the canvas so the clicked world point becomes the viewport center. */
	private navigateTo(evt: PointerEvent): void {
		const { wx, wy } = this.eventToWorld(evt);
		try {
			this.canvas.panTo?.(wx, wy);
		} catch {
			/* internal API drift — ignore */
		}
	}

	/** Double-click: zoom to fit the node nearest the clicked point. */
	private zoomToNearest(evt: PointerEvent): void {
		const { wx, wy } = this.eventToWorld(evt);

		let best: CanvasNode | null = null;
		let bestDist = Infinity;
		for (const n of this.canvas.nodes.values()) {
			// Squared distance from the point to the node's rectangle (0 if inside).
			const dx = Math.max(n.x - wx, 0, wx - (n.x + n.width));
			const dy = Math.max(n.y - wy, 0, wy - (n.y + n.height));
			const dist = dx * dx + dy * dy;
			if (dist < bestDist) {
				bestDist = dist;
				best = n;
			}
		}
		if (!best) return;

		try {
			this.canvas.zoomToBbox?.({
				minX: best.x,
				minY: best.y,
				maxX: best.x + best.width,
				maxY: best.y + best.height,
			});
		} catch {
			/* internal API drift — ignore */
		}
	}
}
