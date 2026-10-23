import type { McpServerConfig } from "../settings";
export type McpServerStatus = {
    name: string;
    status: "starting" | "ready" | "failed" | "reconnecting";
    connected: boolean;
    error?: string;
    toolCount: number;
    tools: string[];
    promptCount: number;
    prompts: string[];
    resourceCount: number;
    resources: string[];
};
export declare class McpManager {
    private clients;
    private tools;
    private prompts;
    private resources;
    private initialized;
    private disposed;
    private configuredServerNames;
    private serverStatuses;
    private onToolsListChanged;
    private onStatusChanged;
    private serverConfigs;
    prepare(servers?: Record<string, McpServerConfig>): void;
    initialize(servers?: Record<string, McpServerConfig>): Promise<void>;
    reconnect(name: string, config?: McpServerConfig): Promise<void>;
    private connectServer;
    private onServerCrash;
    getStatus(): McpServerStatus[];
    getMcpToolDefinitions(): Array<{
        type: "function";
        function: {
            name: string;
            description: string;
            parameters: {
                type: "object";
                properties: Record<string, unknown>;
                required?: string[];
                additionalProperties?: boolean;
            };
        };
    }>;
    isMcpTool(name: string): boolean;
    executeMcpTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<{
        ok: boolean;
        name: string;
        output?: string;
        error?: string;
    }>;
    getMcpPrompt(name: string, args: Record<string, unknown>): Promise<{
        ok: boolean;
        name: string;
        output?: string;
        error?: string;
    }>;
    readMcpResource(name: string, uri: string): Promise<{
        ok: boolean;
        name: string;
        output?: string;
        error?: string;
    }>;
    disconnect(): void;
    private refreshServerTools;
    setOnToolsListChanged(handler: () => void): void;
    setOnStatusChanged(handler: () => void): void;
    private setStatus;
    private buildMcpToolDescription;
}
//# sourceMappingURL=mcp-manager.d.ts.map