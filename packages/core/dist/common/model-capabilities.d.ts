export declare const DEEPSEEK_V4_MODELS: Set<string>;
export type MultimodalMode = "default" | "on" | "off";
export declare function defaultsToThinkingMode(model: string): boolean;
/**
 * Whether the given model supports multimodal (image) content.
 *
 * `mode` is the resolved `multimodal` configuration:
 * - `"on"`: always treat the model as multimodal.
 * - `"off"`: always treat the model as non-multimodal.
 * - `"default"` (or omitted): recognize `deepseek-flash` or model names containing `-vision`.
 */
export declare function supportsMultimodal(model: string, mode?: MultimodalMode): boolean;
//# sourceMappingURL=model-capabilities.d.ts.map