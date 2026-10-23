export const DEEPSEEK_V4_MODELS = new Set([
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-v4-flash-vision-exp",
    "deepseek-flash",
]);
export function defaultsToThinkingMode(model) {
    return DEEPSEEK_V4_MODELS.has(model);
}
/**
 * Whether the given model supports multimodal (image) content.
 *
 * `mode` is the resolved `multimodal` configuration:
 * - `"on"`: always treat the model as multimodal.
 * - `"off"`: always treat the model as non-multimodal.
 * - `"default"` (or omitted): recognize `deepseek-flash` or model names containing `-vision`.
 */
export function supportsMultimodal(model, mode = "default") {
    if (mode === "on") {
        return true;
    }
    if (mode === "off") {
        return false;
    }
    return model === "deepseek-flash" || model.includes("-vision");
}
