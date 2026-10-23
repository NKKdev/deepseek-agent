export type LlmErrorDetails = {
    name: string;
    message: string;
    stack?: string;
    status?: number;
    code?: string;
    type?: string;
    param?: string;
    requestId?: string;
    traceId?: string;
    causes?: LlmErrorDetails[];
};
/**
 * Produce a concise, credential-safe explanation from OpenAI-compatible API
 * errors and their underlying network causes.
 */
export declare function describeLlmError(error: unknown): string;
/**
 * Extract serializable diagnostics for local logs without retaining the
 * original error object, which can contain circular references.
 */
export declare function getLlmErrorDetails(error: unknown): LlmErrorDetails;
//# sourceMappingURL=llm-error.d.ts.map