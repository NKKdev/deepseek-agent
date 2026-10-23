import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "./tool-types";
export type ValidationResult = {
    ok: true;
    input: Record<string, unknown>;
} | {
    ok: false;
    error: string;
};
export declare function semanticBoolean(defaultValue?: boolean): z.ZodPreprocess<z.ZodDefault<z.ZodBoolean>>;
export declare function semanticInteger(label: string, options?: {
    min?: number;
}): z.ZodPreprocess<z.ZodNumber>;
export declare function executeValidatedTool<TSchema extends z.ZodType<Record<string, unknown>>>(name: string, schema: TSchema, rawArgs: Record<string, unknown>, context: ToolExecutionContext, handler: (input: z.infer<TSchema>, context: ToolExecutionContext) => Promise<ToolExecutionResult>, options?: {
    preprocess?: (args: Record<string, unknown>) => ValidationResult;
}): Promise<ToolExecutionResult>;
//# sourceMappingURL=validate.d.ts.map