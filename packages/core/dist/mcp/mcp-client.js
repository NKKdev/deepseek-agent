import { spawn } from "child_process";
import { createInterface } from "readline";
import * as path from "path";
import { killProcessTree } from "../common/process-tree.js";
export class McpClient {
    serverName;
    command;
    args;
    env;
    process = null;
    reader = null;
    nextId = 1;
    pendingRequests = new Map();
    stderrBuffer = "";
    notificationHandler = null;
    disconnectHandler = null;
    intentionallyDisconnected = false;
    constructor(serverName, command, args = [], env, onNotification, onDisconnect) {
        this.serverName = serverName;
        this.command = command;
        this.args = args;
        this.env = env;
        this.notificationHandler = onNotification ?? null;
        this.disconnectHandler = onDisconnect ?? null;
    }
    async connect(timeoutMs) {
        return new Promise((resolve, reject) => {
            this.intentionallyDisconnected = false;
            const childEnv = {
                ...process.env,
                ...this.env,
            };
            const args = this.withNpxYesArg(this.command, this.args);
            const spawnSpec = createMcpSpawnSpec(this.command, args);
            this.process = spawn(spawnSpec.command, spawnSpec.args, {
                stdio: ["pipe", "pipe", "pipe"],
                env: childEnv,
                shell: spawnSpec.shell,
                windowsHide: spawnSpec.windowsHide,
            });
            let resolved = false;
            const safeReject = (err) => {
                if (!resolved) {
                    resolved = true;
                    reject(err);
                }
            };
            this.process.on("error", (err) => {
                safeReject(this.withStderr(`Failed to start MCP server "${this.serverName}" (${this.command}): ${err.message}`));
            });
            this.process.on("close", (code) => {
                const reason = `MCP server "${this.serverName}" exited with code ${code}`;
                const error = this.withStderr(reason);
                for (const [, pending] of this.pendingRequests) {
                    clearTimeout(pending.timer);
                    pending.reject(error);
                }
                this.pendingRequests.clear();
                this.reader?.close();
                this.reader = null;
                this.process = null;
                if (!this.intentionallyDisconnected && this.disconnectHandler) {
                    this.disconnectHandler(reason);
                }
                safeReject(error);
            });
            if (this.process.stderr) {
                this.process.stderr.on("data", (data) => {
                    this.appendStderr(data.toString("utf8"));
                });
            }
            this.reader = createInterface({ input: this.process.stdout });
            this.reader.on("line", (line) => {
                this.handleLine(line);
            });
            // Send initialize request (MCP protocol handshake)
            this.sendRequest("initialize", {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: "deepcode-cli", version: "0.1.0" },
            }, timeoutMs)
                .then((result) => {
                // Validate protocol version from server response (per MCP spec §4.2.1.2)
                const initResult = result;
                const serverVersion = initResult?.protocolVersion;
                if (serverVersion && serverVersion !== "2025-03-26" && serverVersion !== "2024-11-05") {
                    reject(new Error(`Unsupported MCP protocol version "${serverVersion}" from server "${this.serverName}". ` +
                        `Client supports 2025-03-26 and 2024-11-05.`));
                    return;
                }
                // Send initialized notification
                this.sendNotification("notifications/initialized");
                resolve();
            })
                .catch(reject);
        });
    }
    async listTools(timeoutMs) {
        const tools = [];
        let cursor;
        for (let page = 0; page < 100; page++) {
            const params = cursor ? { cursor } : {};
            const result = (await this.sendRequest("tools/list", params, timeoutMs));
            tools.push(...(result.tools ?? []));
            cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
            if (!cursor) {
                return tools;
            }
        }
        throw this.withStderr(`MCP server "${this.serverName}" returned too many tools/list pages`);
    }
    async callTool(name, args, timeoutMs = 60_000) {
        return (await this.sendRequest("tools/call", { name, arguments: args }, timeoutMs));
    }
    async listPrompts(timeoutMs) {
        const prompts = [];
        let cursor;
        for (let page = 0; page < 100; page++) {
            const params = cursor ? { cursor } : {};
            const result = (await this.sendRequest("prompts/list", params, timeoutMs));
            prompts.push(...(result.prompts ?? []));
            cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
            if (!cursor) {
                return prompts;
            }
        }
        throw this.withStderr(`MCP server "${this.serverName}" returned too many prompts/list pages`);
    }
    async getPrompt(name, args, timeoutMs = 30_000) {
        return (await this.sendRequest("prompts/get", { name, arguments: args }, timeoutMs));
    }
    async listResources(timeoutMs) {
        const resources = [];
        let cursor;
        for (let page = 0; page < 100; page++) {
            const params = cursor ? { cursor } : {};
            const result = (await this.sendRequest("resources/list", params, timeoutMs));
            resources.push(...(result.resources ?? []));
            cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
            if (!cursor) {
                return resources;
            }
        }
        throw this.withStderr(`MCP server "${this.serverName}" returned too many resources/list pages`);
    }
    async readResource(uri, timeoutMs = 30_000) {
        return (await this.sendRequest("resources/read", { uri }, timeoutMs));
    }
    disconnect() {
        this.intentionallyDisconnected = true;
        if (this.reader) {
            this.reader.close();
            this.reader = null;
        }
        if (this.process) {
            if (typeof this.process.pid === "number") {
                killProcessTree(this.process.pid, "SIGTERM", { killGroupOnNonWindows: false });
            }
            else {
                this.process.kill();
            }
            this.process = null;
        }
    }
    isConnected() {
        return this.process !== null && this.process.exitCode === null;
    }
    sendRequest(method, params, timeoutMs = 30_000) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const request = {
                jsonrpc: "2.0",
                id,
                method,
                params,
            };
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(this.withStderr(`Timed out after ${timeoutMs}ms waiting for MCP server "${this.serverName}" to respond to ${method}`));
            }, timeoutMs);
            this.pendingRequests.set(id, { resolve, reject, timer });
            this.writeLine(JSON.stringify(request));
        });
    }
    sendNotification(method, params) {
        const notification = {
            jsonrpc: "2.0",
            method,
            params,
        };
        this.writeLine(JSON.stringify(notification));
    }
    writeLine(data) {
        if (this.process?.stdin) {
            this.process.stdin.write(data + "\n");
        }
    }
    handleLine(line) {
        try {
            const parsed = JSON.parse(line);
            // Handle JSON-RPC batch (array of requests/notifications/responses)
            // Per MCP 2025-03-26 §4.1.1.3: implementations MUST support receiving batches.
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && typeof item === "object") {
                        this.handleSingleMessage(item);
                    }
                }
                return;
            }
            // Handle single message
            if (parsed && typeof parsed === "object") {
                this.handleSingleMessage(parsed);
            }
        }
        catch {
            // Ignore unparseable lines
        }
    }
    handleSingleMessage(msg) {
        // Handle notifications (no id field — server-initiated)
        if (!("id" in msg)) {
            const notification = msg;
            if (this.notificationHandler && typeof notification.method === "string") {
                try {
                    this.notificationHandler(notification.method, notification.params);
                }
                catch {
                    // Swallow handler errors to avoid crashing the reader loop
                }
            }
            return;
        }
        // Handle responses to our requests
        const message = msg;
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const pending = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) {
                pending.reject(this.withStderr(`MCP error: ${message.error.message}`));
            }
            else {
                pending.resolve(message.result);
            }
        }
    }
    withNpxYesArg(command, args) {
        const executable = path
            .basename(command)
            .toLowerCase()
            .replace(/\.cmd$/, "");
        if (executable !== "npx") {
            return args;
        }
        if (args.includes("-y") || args.includes("--yes")) {
            return args;
        }
        return ["-y", ...args];
    }
    appendStderr(text) {
        this.stderrBuffer = `${this.stderrBuffer}${text}`;
        if (this.stderrBuffer.length > 4000) {
            this.stderrBuffer = this.stderrBuffer.slice(-4000);
        }
    }
    withStderr(message) {
        const stderr = this.stderrBuffer.trim();
        return new Error(stderr ? `${message}. stderr: ${stderr}` : message);
    }
}
export function createMcpSpawnSpec(command, args, platform = process.platform) {
    if (platform === "win32") {
        return {
            // On Windows, shell: true lets cmd.exe resolve the command via PATHEXT
            // (npx -> npx.cmd, etc.). Join command and args into a single string
            // with empty spawn args to avoid Node 24 DEP0190.
            // Only quote arguments that need protection from cmd.exe to prevent
            // double-wrapping by Node.js's own shell quoting.
            command: [command, ...args].map(quoteWindowsArgIfNeeded).join(" "),
            args: [],
            shell: true,
            windowsHide: true,
        };
    }
    return {
        command,
        args,
        shell: false,
    };
}
function quoteWindowsArgIfNeeded(arg) {
    if (/[\s"&|<>^()]/.test(arg)) {
        return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&")}"`;
    }
    return arg;
}
