import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
export declare function handleReadTool(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;
export declare function resolveReadFilePath(value: unknown, projectRoot: string): {
    ok: true;
    filePath: string;
} | {
    ok: false;
    error: string;
};
//# sourceMappingURL=read-handler.d.ts.map