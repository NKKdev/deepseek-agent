import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
export declare function clearSessionWorkingDir(sessionId: string): void;
export declare function handleBashTool(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;
//# sourceMappingURL=bash-handler.d.ts.map