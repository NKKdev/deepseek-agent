import type { LlmErrorDetails } from "./llm-error";
export type ApiErrorLogEntry = {
    timestamp: string;
    location: string;
    requestId: string;
    sessionId?: string;
    model?: string;
    baseURL?: string;
    error: LlmErrorDetails;
    request: Record<string, unknown>;
    response?: unknown;
};
/**
 * Write an API error log entry to ~/.deepcode/logs/error.log.
 */
export declare function logApiError(entry: ApiErrorLogEntry): void;
//# sourceMappingURL=error-logger.d.ts.map