import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, MinimapSettings, MinimapSettingTab } from "./settings";
import { Minimap } from "./minimap";
import type { Canvas } from "./types";

export default class CanvasMinimapPlugin extends Plugin {
	settings: MinimapSettings;
	private minimaps = new Map<WorkspaceLeaf, Minimap>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MinimapSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("layout-change", () => this.sync()));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.sync()));
		this.app.workspace.onLayoutReady(() => this.sync());

		this.addCommand({
			id: "toggle-minimap",
			name: "Toggle minimap",
			callback: async () => {
				this.settings.enabled = !this.settings.enabled;
				await this.saveSettings();
			},
		});
	}

	onunload(): void {
		for (const m of this.minimaps.values()) m.destroy();
		this.minimaps.clear();
	}

	/** Reconcile minimap instances with the currently open canvas leaves. */
	private sync(): void {
		const liveLeaves = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view as { getViewType?: () => string };
			if (view?.getViewType?.() === "canvas") liveLeaves.add(leaf);
		});

		for (const [leaf, m] of this.minimaps) {
			if (!liveLeaves.has(leaf) || !this.settings.enabled) {
				m.destroy();
				this.minimaps.delete(leaf);
			}
		}

		if (!this.settings.enabled) return;

		for (const leaf of liveLeaves) {
			if (this.minimaps.has(leaf)) continue;
			const canvas = (leaf.view as unknown as { canvas?: Canvas }).canvas;
			if (!canvas?.wrapperEl) continue;
			this.minimaps.set(leaf, new Minimap(canvas, this.settings));
		}
	}

	private refreshAll(): void {
		for (const m of this.minimaps.values()) m.updateSettings(this.settings);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<MinimapSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.sync();
		this.refreshAll();
	}
}
