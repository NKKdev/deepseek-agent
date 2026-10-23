import { createHash } from "crypto";
import { McpClient } from "./mcp-client.js";
const MCP_STARTUP_TIMEOUT_MS = process.env.DEEPCODE_MCP_TIMEOUT
    ? parseInt(process.env.DEEPCODE_MCP_TIMEOUT, 10)
    : 30_000;
const MCP_CALL_TOOL_TIMEOUT_MS = 60_000;
const API_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const API_TOOL_NAME_MAX_LENGTH = 64;
function buildMcpNamespacedName(serverName, toolName, usedNames = new Set()) {
    const rawName = buildRawMcpNamespacedName(serverName, toolName);
    const sanitizedName = `mcp__${sanitizeApiToolNamePart(serverName)}__${sanitizeApiToolNamePart(toolName)}`;
    let candidate = fitApiToolName(sanitizedName, rawName);
    if (!usedNames.has(candidate)) {
        return candidate;
    }
    const hash = hashToolName(rawName);
    candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}`);
    if (!usedNames.has(candidate)) {
        return candidate;
    }
    for (let index = 2;; index += 1) {
        candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}_${index}`);
        if (!usedNames.has(candidate)) {
            return candidate;
        }
    }
}
export class McpManager {
    clients = [];
    tools = [];
    prompts = [];
    resources = [];
    initialized = false;
    disposed = false;
    configuredServerNames = [];
    serverStatuses = [];
    onToolsListChanged = null;
    onStatusChanged = null;
    serverConfigs = {};
    prepare(servers) {
        if (!servers || Object.keys(servers).length === 0)
            return;
        this.disposed = false;
        for (const name of Object.keys(servers)) {
            if (!this.configuredServerNames.includes(name)) {
                this.configuredServerNames.push(name);
            }
            if (this.serverStatuses.some((status) => status.name === name)) {
                continue;
            }
            this.setStatus({
                name,
                status: "starting",
                connected: false,
                toolCount: 0,
                tools: [],
                promptCount: 0,
                prompts: [],
                resourceCount: 0,
                resources: [],
            });
        }
    }
    async initialize(servers) {
        if (this.initialized || this.disposed)
            return;
        this.initialized = true;
        if (!servers || Object.keys(servers).length === 0)
            return;
        this.serverConfigs = servers;
        this.prepare(servers);
        for (const [name, config] of Object.entries(servers)) {
            if (this.disposed)
                break;
            await this.connectServer(name, config);
        }
    }
    async reconnect(name, config) {
        if (this.disposed)
            return;
        const effectiveConfig = config ?? this.serverConfigs[name];
        if (!effectiveConfig)
            return;
        if (config) {
            this.serverConfigs[name] = config;
        }
        this.setStatus({
            name,
            status: "reconnecting",
            connected: false,
            error: "Reconnecting...",
            toolCount: 0,
            tools: [],
            promptCount: 0,
            prompts: [],
            resourceCount: 0,
            resources: [],
        });
        await this.connectServer(name, effectiveConfig);
    }
    async connectServer(name, config) {
        if (this.disposed)
            return;
        // Clean up stale entries from previous connection attempts
        this.clients = this.clients.filter((c) => c.isConnected());
        this.tools = this.tools.filter((t) => t.serverName !== name);
        this.prompts = this.prompts.filter((p) => p.serverName !== name);
        this.resources = this.resources.filter((r) => r.serverName !== name);
        let client = null;
        try {
            client = new McpClient(name, config.command, config.args ?? [], config.env, (method) => {
                if (method === "notifications/tools/list_changed") {
                    this.refreshServerTools(name, client).catch(() => { });
                }
            }, (reason) => {
                if (!this.disposed && this.serverConfigs[name]) {
                    this.onServerCrash(name, reason);
                }
            });
            await client.connect(MCP_STARTUP_TIMEOUT_MS);
            if (this.disposed) {
                client.disconnect();
                return;
            }
            this.clients.push(client);
            const serverTools = await client.listTools(MCP_STARTUP_TIMEOUT_MS);
            if (this.disposed)
                return;
            const toolNamespacedNames = [];
            const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
            for (const tool of serverTools) {
                const namespacedName = buildMcpNamespacedName(name, tool.name, usedToolNames);
                usedToolNames.add(namespacedName);
                this.tools.push({
                    serverName: name,
                    originalName: tool.name,
                    namespacedName,
                    definition: tool,
                    client,
                });
                toolNamespacedNames.push(namespacedName);
            }
            let serverPrompts = [];
            try {
                serverPrompts = await client.listPrompts(MCP_STARTUP_TIMEOUT_MS);
            }
            catch {
                // server may not support prompts
            }
            if (this.disposed)
                return;
            const promptNamespacedNames = [];
            for (const prompt of serverPrompts) {
                const namespacedName = `mcp__${name}__${prompt.name}`;
                this.prompts.push({
                    serverName: name,
                    namespacedName,
                    definition: prompt,
                    client,
                });
                promptNamespacedNames.push(namespacedName);
            }
            let serverResources = [];
            try {
                serverResources = await client.listResources(MCP_STARTUP_TIMEOUT_MS);
            }
            catch {
                // server may not support resources
            }
            if (this.disposed)
                return;
            const resourceNamespacedNames = [];
            for (const resource of serverResources) {
                const namespacedName = `mcp__${name}__${resource.name}`;
                this.resources.push({
                    serverName: name,
                    namespacedName,
                    definition: resource,
                    client,
                });
                resourceNamespacedNames.push(namespacedName);
            }
            this.setStatus({
                name,
                status: "ready",
                connected: true,
                toolCount: serverTools.length,
                tools: toolNamespacedNames,
                promptCount: serverPrompts.length,
                prompts: promptNamespacedNames,
                resourceCount: serverResources.length,
                resources: resourceNamespacedNames,
            });
        }
        catch (err) {
            client?.disconnect();
            const message = err instanceof Error ? err.message : String(err);
            this.setStatus({
                name,
                status: "failed",
                connected: false,
                error: message,
                toolCount: 0,
                tools: [],
                promptCount: 0,
                prompts: [],
                resourceCount: 0,
                resources: [],
            });
        }
    }
    onServerCrash(name, reason) {
        if (this.disposed)
            return;
        this.clients = this.clients.filter((c) => c.isConnected());
        this.tools = this.tools.filter((t) => t.serverName !== name);
        this.prompts = this.prompts.filter((p) => p.serverName !== name);
        this.resources = this.resources.filter((r) => r.serverName !== name);
        this.onToolsListChanged?.();
        this.setStatus({
            name,
            status: "failed",
            connected: false,
            error: reason,
            toolCount: 0,
            tools: [],
            promptCount: 0,
            prompts: [],
            resourceCount: 0,
            resources: [],
        });
    }
    getStatus() {
        const result = [...this.serverStatuses];
        const knownNames = new Set(result.map((s) => s.name));
        for (const name of this.configuredServerNames) {
            if (!knownNames.has(name)) {
                result.push({
                    name,
                    status: "starting",
                    connected: false,
                    toolCount: 0,
                    tools: [],
                    promptCount: 0,
                    prompts: [],
                    resourceCount: 0,
                    resources: [],
                });
            }
        }
        return result;
    }
    getMcpToolDefinitions() {
        return this.tools.map((t) => ({
            type: "function",
            function: {
                name: t.namespacedName,
                description: this.buildMcpToolDescription(t),
                parameters: {
                    type: "object",
                    properties: t.definition.inputSchema.properties,
                    required: t.definition.inputSchema.required,
                    ...(t.definition.inputSchema.additionalProperties !== undefined
                        ? { additionalProperties: t.definition.inputSchema.additionalProperties }
                        : {}),
                },
            },
        }));
    }
    isMcpTool(name) {
        return name.startsWith("mcp__");
    }
    async executeMcpTool(name, args, timeoutMs = MCP_CALL_TOOL_TIMEOUT_MS) {
        const tool = this.tools.find((t) => t.namespacedName === name);
        if (!tool) {
            return { ok: false, name, error: `Unknown MCP tool: ${name}` };
        }
        try {
            const result = await tool.client.callTool(tool.originalName, args, timeoutMs);
            const text = result.content
                .filter((c) => c.type === "text" && c.text)
                .map((c) => c.text)
                .join("\n");
            return {
                ok: !result.isError,
                name,
                output: text || JSON.stringify(result.content),
            };
        }
        catch (err) {
            return {
                ok: false,
                name,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    async getMcpPrompt(name, args) {
        const prompt = this.prompts.find((p) => p.namespacedName === name);
        if (!prompt) {
            return { ok: false, name, error: `Unknown MCP prompt: ${name}` };
        }
        try {
            const result = await prompt.client.getPrompt(prompt.definition.name, args);
            const text = result.messages
                .filter((m) => m.content.type === "text" && m.content.text)
                .map((m) => `[${m.role}] ${m.content.text}`)
                .join("\n");
            return {
                ok: true,
                name,
                output: text || JSON.stringify(result),
            };
        }
        catch (err) {
            return {
                ok: false,
                name,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    async readMcpResource(name, uri) {
        const resource = this.resources.find((r) => r.namespacedName === name);
        if (!resource) {
            return { ok: false, name, error: `Unknown MCP resource: ${name}` };
        }
        try {
            const result = await resource.client.readResource(uri);
            const text = result.contents
                .filter((c) => c.text)
                .map((c) => c.text)
                .join("\n");
            return {
                ok: true,
                name,
                output: text || JSON.stringify(result.contents),
            };
        }
        catch (err) {
            return {
                ok: false,
                name,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
    disconnect() {
        this.disposed = true;
        for (const client of this.clients) {
            client.disconnect();
        }
        this.clients = [];
        this.tools = [];
        this.prompts = [];
        this.resources = [];
        this.serverStatuses = [];
        this.configuredServerNames = [];
        this.serverConfigs = {};
        this.initialized = false;
    }
    async refreshServerTools(serverName, client) {
        const serverTools = await client.listTools(MCP_STARTUP_TIMEOUT_MS);
        this.tools = this.tools.filter((t) => t.serverName !== serverName);
        const toolNamespacedNames = [];
        const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
        for (const tool of serverTools) {
            const namespacedName = buildMcpNamespacedName(serverName, tool.name, usedToolNames);
            usedToolNames.add(namespacedName);
            this.tools.push({
                serverName,
                originalName: tool.name,
                namespacedName,
                definition: tool,
                client,
            });
            toolNamespacedNames.push(namespacedName);
        }
        const existing = this.serverStatuses.find((s) => s.name === serverName);
        if (existing) {
            existing.toolCount = serverTools.length;
            existing.tools = toolNamespacedNames;
        }
        this.onToolsListChanged?.();
    }
    setOnToolsListChanged(handler) {
        this.onToolsListChanged = handler;
    }
    setOnStatusChanged(handler) {
        this.onStatusChanged = handler;
    }
    setStatus(status) {
        if (this.disposed)
            return;
        const index = this.serverStatuses.findIndex((s) => s.name === status.name);
        if (index === -1) {
            this.serverStatuses.push(status);
        }
        else {
            this.serverStatuses[index] = status;
        }
        this.onStatusChanged?.();
    }
    buildMcpToolDescription(tool) {
        const description = tool.definition.description?.trim();
        const source = `${tool.serverName}: ${tool.originalName}`;
        if (!description) {
            return source;
        }
        if (tool.namespacedName === buildRawMcpNamespacedName(tool.serverName, tool.originalName)) {
            return description;
        }
        return `${description}\nMCP source: ${source}`;
    }
}
function buildRawMcpNamespacedName(serverName, toolName) {
    return `mcp__${serverName}__${toolName}`;
}
function sanitizeApiToolNamePart(value) {
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
    return sanitized || "unnamed";
}
function fitApiToolName(name, rawName) {
    if (API_TOOL_NAME_PATTERN.test(name) && name.length <= API_TOOL_NAME_MAX_LENGTH) {
        return name;
    }
    return fitApiToolNameWithSuffix(name, `_${hashToolName(rawName)}`);
}
function fitApiToolNameWithSuffix(name, suffix) {
    const maxPrefixLength = API_TOOL_NAME_MAX_LENGTH - suffix.length;
    const prefix = name.slice(0, Math.max(1, maxPrefixLength));
    return `${prefix}${suffix}`;
}
function hashToolName(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
