// Type shims for Obsidian's *internal* Canvas API.
// None of this is part of the public plugin API, so every access at the call
// site is treated as best-effort and wrapped defensively. These shapes reflect
// the Canvas internals as of Obsidian 1.x and may break on future updates.

export interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface CanvasNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

export interface Canvas {
	/** Map of node id -> node. */
	nodes: Map<string, CanvasNode>;
	/** The element the canvas viewport lives in; we mount the minimap here. */
	wrapperEl: HTMLElement;

	/** Returns the currently visible region in canvas (world) coordinates. */
	getViewportBBox?: () => BBox;
	/** Pans the viewport so that (x, y) becomes the center. */
	panTo?: (x: number, y: number) => void;
	/** Zooms/pans the viewport to fit the given bbox (with some margin). */
	zoomToBbox?: (bbox: BBox) => void;

	// Smoothed transform target — used only as a fallback / change signal.
	tx?: number;
	ty?: number;
	tZoom?: number;
}

export interface CanvasView {
	canvas: Canvas;
	getViewType(): string;
}
