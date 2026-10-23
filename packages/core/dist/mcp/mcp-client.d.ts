export type McpToolDefinition = {
    name: string;
    description?: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
    };
};
type CallToolResult = {
    content: Array<{
        type: string;
        text?: string;
    }>;
    isError?: boolean;
};
export type McpPromptArgument = {
    name: string;
    description?: string;
    required?: boolean;
};
export type McpPromptDefinition = {
    name: string;
    description?: string;
    arguments?: McpPromptArgument[];
};
export type McpPromptMessage = {
    role: "user" | "assistant";
    content: {
        type: string;
        text?: string;
    };
};
type GetPromptResult = {
    description?: string;
    messages: McpPromptMessage[];
};
export type McpResourceDefinition = {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
};
export type McpResourceContent = {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
};
type ReadResourceResult = {
    contents: McpResourceContent[];
};
export type McpNotificationHandler = (method: string, params?: Record<string, unknown>) => void;
export type McpSpawnSpec = {
    command: string;
    args: string[];
    shell: boolean;
    windowsHide?: boolean;
};
export declare class McpClient {
    private readonly serverName;
    private readonly command;
    private readonly args;
    private readonly env?;
    private process;
    private reader;
    private nextId;
    private pendingRequests;
    private stderrBuffer;
    private notificationHandler;
    private disconnectHandler;
    private intentionallyDisconnected;
    constructor(serverName: string, command: string, args?: string[], env?: Record<string, string> | undefined, onNotification?: McpNotificationHandler, onDisconnect?: (reason: string) => void);
    connect(timeoutMs: number): Promise<void>;
    listTools(timeoutMs: number): Promise<McpToolDefinition[]>;
    callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<CallToolResult>;
    listPrompts(timeoutMs: number): Promise<McpPromptDefinition[]>;
    getPrompt(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<GetPromptResult>;
    listResources(timeoutMs: number): Promise<McpResourceDefinition[]>;
    readResource(uri: string, timeoutMs?: number): Promise<ReadResourceResult>;
    disconnect(): void;
    isConnected(): boolean;
    private sendRequest;
    private sendNotification;
    private writeLine;
    private handleLine;
    private handleSingleMessage;
    private withNpxYesArg;
    private appendStderr;
    private withStderr;
}
export declare function createMcpSpawnSpec(command: string, args: string[], platform?: NodeJS.Platform): McpSpawnSpec;
export {};
//# sourceMappingURL=mcp-client.d.ts.map