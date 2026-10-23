export function buildThinkingRequestOptions(thinkingEnabled, _baseURL, reasoningEffort = "max") {
    const thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
    return {
        thinking,
        ...(thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}),
    };
}
