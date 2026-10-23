import type { ReasoningEffort } from "../settings";
type ThinkingConfig = {
    type: "enabled" | "disabled";
};
type ThinkingRequestOptions = {
    thinking?: ThinkingConfig;
    extra_body?: {
        reasoning_effort?: ReasoningEffort;
    };
};
export declare function buildThinkingRequestOptions(thinkingEnabled: boolean, _baseURL?: string, reasoningEffort?: ReasoningEffort): ThinkingRequestOptions;
export {};
//# sourceMappingURL=openai-thinking.d.ts.map