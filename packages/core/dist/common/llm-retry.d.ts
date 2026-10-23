export declare const MAX_LLM_RETRIES = 5;
export declare const LLM_STREAM_IDLE_TIMEOUT_MS = 60000;
export declare class LlmStreamIdleTimeoutError extends Error {
    constructor();
}
export declare class LlmStreamDisconnectedError extends Error {
    constructor();
}
export declare function getLlmRetryDelayMs(attempt: number, random?: () => number): number;
export declare function getLlmRetryAfterMs(error: unknown, now?: number): number | undefined;
export declare function isRetryableLlmError(error: unknown): boolean;
export declare function waitForLlmRetry(delayMs: number, signal?: AbortSignal): Promise<void>;
//# sourceMappingURL=llm-retry.d.ts.map