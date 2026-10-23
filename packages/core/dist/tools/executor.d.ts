import type { McpManager } from "../mcp/mcp-manager";
import type { CreateOpenAIClient, SharpLoader, ToolExecutionHooks, ToolCallExecution } from "../common/tool-types";
export type { CreateOpenAIClient, SharpLoader, ToolCall, ToolExecutionContext, ToolExecutionHooks, ToolExecutionResult, ToolHandler, ToolCallExecution, ProcessTimeoutInfo, ProcessTimeoutControl, BackgroundProcessCompletion, ToolExecutionFollowUpMessage, PluginRateLimitedTool, } from "../common/tool-types";
export declare class ToolExecutor {
    private readonly projectRoot;
    private readonly createOpenAIClient?;
    private readonly mcpManager?;
    private readonly loadSharp?;
    private readonly toolHandlers;
    constructor(projectRoot: string, createOpenAIClient?: CreateOpenAIClient, mcpManager?: McpManager, loadSharp?: SharpLoader);
    executeToolCalls(sessionId: string, toolCalls: unknown[], hooks?: ToolExecutionHooks): Promise<ToolCallExecution[]>;
    private registerToolHandlers;
    private parseToolCall;
    private executeToolCall;
    private parseToolArguments;
    private formatToolResult;
}
//# sourceMappingURL=executor.d.ts.map