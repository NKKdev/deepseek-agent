import type { PermissionScope, PermissionSettings } from "../settings";
import type { ToolExecutionFollowUpMessage } from "./tool-types";
export type BashPermissionScope = Exclude<PermissionScope, "mcp"> | "unknown";
type PermissionPolicySettings = Required<Omit<PermissionSettings, "addWorkingDirs">> & Pick<PermissionSettings, "addWorkingDirs">;
export type PermissionDecision = "allow" | "deny" | "ask";
export type UserToolPermission = {
    toolCallId: string;
    permission: "allow" | "deny";
};
export type MessageToolPermission = {
    toolCallId: string;
    permission: PermissionDecision;
};
export type AskPermissionScope = PermissionScope | "unknown";
export type AskPermissionRequest = {
    toolCallId: string;
    scopes: AskPermissionScope[];
    name: string;
    command: string;
    description?: string;
};
export type PermissionToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};
export type PermissionToolExecution = {
    toolCallId: string;
    content: string;
    result: {
        ok: boolean;
        name: string;
        output?: string;
        error?: string;
        metadata?: Record<string, unknown>;
        awaitUserResponse?: boolean;
        followUpMessages?: ToolExecutionFollowUpMessage[];
    };
};
export type PermissionPlan = {
    permissions: MessageToolPermission[];
    askPermissions: AskPermissionRequest[];
};
export type ComputeToolCallPermissionsOptions = {
    sessionId: string;
    projectRoot: string;
    toolCalls: unknown[];
    settings?: PermissionPolicySettings;
    forceAskScopes?: readonly PermissionScope[];
    readPermissionExemptPaths?: string[];
    resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined;
};
export declare function parseToolCallForPermissions(toolCall: unknown): PermissionToolCall | null;
export declare function buildPermissionToolExecution(toolCall: PermissionToolCall, options: {
    permissionOverrides?: UserToolPermission[];
    messagePermissions?: MessageToolPermission[];
}): PermissionToolExecution | null;
export declare function resolveToolCallPermission(toolCallId: string, options: {
    permissionOverrides?: UserToolPermission[];
    messagePermissions?: MessageToolPermission[];
}): PermissionDecision;
export declare function buildSyntheticToolExecution(toolCall: PermissionToolCall, error: string): PermissionToolExecution;
export declare function computeToolCallPermissions(options: ComputeToolCallPermissionsOptions): PermissionPlan;
export declare function describeToolPermissionRequest(options: {
    sessionId: string;
    projectRoot: string;
    addWorkingDirs?: string[];
    toolCall: PermissionToolCall;
    readPermissionExemptPaths?: string[];
    resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined;
}): AskPermissionRequest;
export declare function evaluatePermissionScopes(scopes: AskPermissionScope[], settings?: PermissionPolicySettings): PermissionDecision;
export declare function getPermissionScopesRequiringAsk(scopes: AskPermissionScope[], settings?: PermissionPolicySettings): AskPermissionScope[];
export declare function parseBashSideEffects(value: unknown): AskPermissionScope[];
export declare function parseToolArgumentsForPermissions(rawArguments: string): Record<string, unknown>;
export declare function resolveEditPermissionPath(sessionId: string, args: Record<string, unknown>, resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined): string;
export declare function formatToolPathCommand(toolName: string, filePath: string): string;
export declare function isPathInProject(projectRoot: string, filePath: string): boolean;
export declare function classifyFilePermissionScope(projectRoot: string, filePath: string, operation: "read" | "write", addWorkingDirs?: string[]): PermissionScope;
export declare function isPathInAnyDirectory(projectRoot: string, filePath: string, directories: string[] | undefined): boolean;
export declare function hasUserPermissionReplies(value: {
    permissions?: unknown;
    alwaysAllows?: unknown;
}): boolean;
export declare function appendProjectPermissionAllows(projectRoot: string, scopes: PermissionScope[] | undefined, options?: {
    inheritedPermissions?: PermissionPolicySettings;
}): void;
export declare function normalizeAskPermissions(value: unknown): AskPermissionRequest[] | undefined;
export declare function isAskPermissionScope(value: unknown): value is AskPermissionScope;
export {};
//# sourceMappingURL=permissions.d.ts.map