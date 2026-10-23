export type OpenAIChatCompletionDebugEntry = {
    timestamp: string;
    location: string;
    requestId?: string;
    sessionId?: string;
    model?: string;
    baseURL?: string;
    durationMs?: number;
    params?: Record<string, unknown>;
    request: Record<string, unknown>;
    response?: unknown;
    responseChunks?: unknown[];
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
};
export declare function logOpenAIChatCompletionDebug(entry: OpenAIChatCompletionDebugEntry): void;
export declare function getDebugLogPath(): string;
export declare function normalizeDebugError(error: unknown): {
    name: string;
    message: string;
    stack?: string;
};
//# sourceMappingURL=debug-logger.d.ts.map