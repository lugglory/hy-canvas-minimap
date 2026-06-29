import { App, PluginSettingTab, Setting } from "obsidian";
import type CanvasMinimapPlugin from "./main";

export type MinimapPosition = "bottom-left" | "bottom-right";

export interface MinimapSettings {
	/** Master on/off. */
	enabled: boolean;
	/** Which corner the minimap docks to. */
	position: MinimapPosition;
	/** Side length of the square minimap box as a fraction of the canvas view's
	 *  shorter side (0.10–0.40), clamped to SIZE_MIN_PX..SIZE_MAX_PX. Content is
	 *  fit inside, centered, preserving the canvas aspect ratio (letterboxed). */
	sizeRatio: number;
}

export const DEFAULT_SETTINGS: MinimapSettings = {
	enabled: true,
	position: "bottom-left",
	sizeRatio: 0.25,
};

// Slider bounds, expressed as percent of the canvas view's shorter side.
export const MIN_RATIO_PCT = 10;
export const MAX_RATIO_PCT = 40;

export class MinimapSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: CanvasMinimapPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Show minimap")
			.setDesc("Display the minimap on Canvas views.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
					this.plugin.settings.enabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Position")
			.setDesc("Which corner the minimap docks to.")
			.addDropdown((d) =>
				d
					.addOption("bottom-left", "Bottom left")
					.addOption("bottom-right", "Bottom right")
					.setValue(this.plugin.settings.position)
					.onChange(async (v) => {
						this.plugin.settings.position = v as MinimapPosition;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Size")
			.setDesc(
				`Minimap side length as a percent of the canvas view's shorter side (${MIN_RATIO_PCT}–${MAX_RATIO_PCT}%). Scales with window/monitor, clamped to a sensible pixel range.`,
			)
			.addSlider((s) =>
				s
					.setLimits(MIN_RATIO_PCT, MAX_RATIO_PCT, 1)
					.setValue(Math.round(this.plugin.settings.sizeRatio * 100))
					.onChange(async (v) => {
						this.plugin.settings.sizeRatio = v / 100;
						await this.plugin.saveSettings();
					}),
			);
	}
}
