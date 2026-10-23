import * as fs from "fs";
import * as path from "path";
import { isAbsoluteFilePath, normalizeFilePath } from "./state.js";
export function parseToolCallForPermissions(toolCall) {
    if (!toolCall || typeof toolCall !== "object") {
        return null;
    }
    const record = toolCall;
    if (typeof record.id !== "string" || !record.function || typeof record.function !== "object") {
        return null;
    }
    if (typeof record.function.name !== "string") {
        return null;
    }
    return {
        id: record.id,
        type: "function",
        function: {
            name: record.function.name,
            arguments: typeof record.function.arguments === "string" ? record.function.arguments : "",
        },
    };
}
export function buildPermissionToolExecution(toolCall, options) {
    const permission = resolveToolCallPermission(toolCall.id, options);
    if (permission === "allow") {
        return null;
    }
    if (permission === "deny") {
        return buildSyntheticToolExecution(toolCall, "User denied the required permission for this tool call. Do not try to bypass this decision.");
    }
    return buildSyntheticToolExecution(toolCall, "The user has not authorized this tool call yet. Retry only if the permission is still necessary.");
}
export function resolveToolCallPermission(toolCallId, options) {
    const override = options.permissionOverrides?.find((item) => item.toolCallId === toolCallId);
    if (override?.permission === "allow" || override?.permission === "deny") {
        return override.permission;
    }
    const messagePermission = options.messagePermissions?.find((item) => item.toolCallId === toolCallId);
    if (messagePermission?.permission === "allow" ||
        messagePermission?.permission === "deny" ||
        messagePermission?.permission === "ask") {
        return messagePermission.permission;
    }
    return "allow";
}
export function buildSyntheticToolExecution(toolCall, error) {
    const result = {
        ok: false,
        name: toolCall.function.name,
        error,
    };
    return {
        toolCallId: toolCall.id,
        content: JSON.stringify(result, null, 2),
        result,
    };
}
export function computeToolCallPermissions(options) {
    const permissions = [];
    const askPermissions = [];
    for (const rawToolCall of options.toolCalls) {
        const toolCall = parseToolCallForPermissions(rawToolCall);
        if (!toolCall) {
            continue;
        }
        const request = describeToolPermissionRequest({
            sessionId: options.sessionId,
            projectRoot: options.projectRoot,
            addWorkingDirs: options.settings?.addWorkingDirs,
            toolCall,
            readPermissionExemptPaths: options.readPermissionExemptPaths,
            resolveSnippetPath: options.resolveSnippetPath,
        });
        const evaluatedPermission = evaluatePermissionScopes(request.scopes, options.settings);
        const forcedAskScopes = evaluatedPermission === "deny"
            ? []
            : getAllowedForcedAskScopes(request.scopes, options.settings, options.forceAskScopes);
        const permission = forcedAskScopes.length > 0 ? "ask" : evaluatedPermission;
        permissions.push({ toolCallId: toolCall.id, permission });
        if (permission === "ask") {
            const askScopes = mergeAskScopes(getPermissionScopesRequiringAsk(request.scopes, options.settings), forcedAskScopes);
            askPermissions.push({
                toolCallId: toolCall.id,
                scopes: askScopes.length > 0 ? askScopes : request.scopes,
                name: request.name,
                command: request.command,
                description: request.description,
            });
        }
    }
    return { permissions, askPermissions };
}
function getAllowedForcedAskScopes(scopes, settings, forceAskScopes) {
    if (!forceAskScopes?.length) {
        return [];
    }
    return scopes.filter((scope) => scope !== "unknown" && forceAskScopes.includes(scope) && evaluatePermissionScopes([scope], settings) === "allow");
}
function mergeAskScopes(existing, forced) {
    return [...existing, ...forced.filter((scope) => !existing.includes(scope))];
}
export function describeToolPermissionRequest(options) {
    const name = options.toolCall.function.name;
    const args = parseToolArgumentsForPermissions(options.toolCall.function.arguments);
    if (name === "read" || name === "Read" || name === "ReadImage") {
        const filePath = typeof args.file_path === "string" ? args.file_path : "";
        return {
            toolCallId: options.toolCall.id,
            name,
            command: formatToolPathCommand(name === "ReadImage" ? "read-image" : "read", filePath),
            scopes: filePath && !isPathInAnyDirectory(options.projectRoot, filePath, options.readPermissionExemptPaths)
                ? [classifyFilePermissionScope(options.projectRoot, filePath, "read", options.addWorkingDirs)]
                : [],
        };
    }
    if (name === "write" || name === "Write") {
        const filePath = typeof args.file_path === "string" ? args.file_path : "";
        return {
            toolCallId: options.toolCall.id,
            name,
            command: formatToolPathCommand("write", filePath),
            scopes: filePath
                ? [classifyFilePermissionScope(options.projectRoot, filePath, "write", options.addWorkingDirs)]
                : [],
        };
    }
    if (name === "edit" || name === "Edit") {
        const filePath = resolveEditPermissionPath(options.sessionId, args, options.resolveSnippetPath);
        return {
            toolCallId: options.toolCall.id,
            name,
            command: formatToolPathCommand("edit", filePath),
            scopes: filePath
                ? [classifyFilePermissionScope(options.projectRoot, filePath, "write", options.addWorkingDirs)]
                : ["write-out-cwd"],
        };
    }
    if (name === "bash" || name === "Bash") {
        const command = typeof args.command === "string" ? args.command : "bash";
        const description = typeof args.description === "string" ? args.description : undefined;
        return {
            toolCallId: options.toolCall.id,
            name: "bash",
            command,
            description,
            scopes: parseBashSideEffects(args.sideEffects),
        };
    }
    if (name === "WebSearch") {
        const query = typeof args.query === "string" ? args.query : "WebSearch";
        return {
            toolCallId: options.toolCall.id,
            name,
            command: query,
            scopes: ["network"],
        };
    }
    if (name === "UnderstandImage") {
        const imagePath = typeof args.image_path === "string" ? args.image_path : "";
        const scopes = ["network"];
        if (imagePath && !isPathInAnyDirectory(options.projectRoot, imagePath, options.readPermissionExemptPaths)) {
            scopes.unshift(classifyFilePermissionScope(options.projectRoot, imagePath, "read", options.addWorkingDirs));
        }
        return {
            toolCallId: options.toolCall.id,
            name,
            command: imagePath ? `understand-image ${imagePath}` : "understand-image",
            scopes,
        };
    }
    if (name.startsWith("mcp__")) {
        return {
            toolCallId: options.toolCall.id,
            name,
            command: name,
            scopes: ["mcp"],
        };
    }
    return {
        toolCallId: options.toolCall.id,
        name,
        command: name,
        scopes: [],
    };
}
export function evaluatePermissionScopes(scopes, settings = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
    addWorkingDirs: [],
}) {
    if (scopes.includes("unknown") && settings.defaultMode !== "allowAll") {
        return "ask";
    }
    if (scopes.length === 0) {
        return "allow";
    }
    const permissionScopes = scopes.filter((scope) => scope !== "unknown");
    if (permissionScopes.some((scope) => settings.deny.includes(scope))) {
        return "deny";
    }
    if (permissionScopes.some((scope) => settings.ask.includes(scope))) {
        return "ask";
    }
    if (permissionScopes.every((scope) => settings.allow.includes(scope))) {
        return "allow";
    }
    return settings.defaultMode === "askAll" ? "ask" : "allow";
}
export function getPermissionScopesRequiringAsk(scopes, settings = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
    addWorkingDirs: [],
}) {
    const result = [];
    for (const scope of scopes) {
        if (scope === "unknown") {
            if (settings.defaultMode !== "allowAll") {
                result.push(scope);
            }
            continue;
        }
        if (settings.deny.includes(scope)) {
            continue;
        }
        if (settings.ask.includes(scope)) {
            result.push(scope);
            continue;
        }
        if (settings.allow.includes(scope)) {
            continue;
        }
        if (settings.defaultMode === "askAll") {
            result.push(scope);
        }
    }
    return result;
}
export function parseBashSideEffects(value) {
    const validScopes = new Set([
        "read-in-cwd",
        "read-in-tmp",
        "read-out-cwd",
        "write-in-cwd",
        "write-in-tmp",
        "write-out-cwd",
        "delete-in-cwd",
        "delete-out-cwd",
        "query-git-log",
        "mutate-git-log",
        "network",
        "unknown",
    ]);
    if (!Array.isArray(value)) {
        return ["unknown"];
    }
    const scopes = [];
    for (const item of value) {
        if (typeof item !== "string" || !validScopes.has(item)) {
            return ["unknown"];
        }
        const scope = item;
        if (!scopes.includes(scope)) {
            scopes.push(scope);
        }
    }
    if (scopes.includes("unknown")) {
        return ["unknown"];
    }
    return scopes;
}
export function parseToolArgumentsForPermissions(rawArguments) {
    if (!rawArguments) {
        return {};
    }
    try {
        const parsed = JSON.parse(rawArguments);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
export function resolveEditPermissionPath(sessionId, args, resolveSnippetPath) {
    const filePath = typeof args.file_path === "string" ? args.file_path : "";
    if (filePath) {
        return filePath;
    }
    const snippetId = typeof args.snippet_id === "string" ? args.snippet_id : "";
    return snippetId ? (resolveSnippetPath?.(sessionId, snippetId) ?? "") : "";
}
export function formatToolPathCommand(toolName, filePath) {
    return filePath ? `${toolName} ${filePath}` : toolName;
}
export function isPathInProject(projectRoot, filePath) {
    return isPathInDirectory(projectRoot, filePath, projectRoot);
}
export function classifyFilePermissionScope(projectRoot, filePath, operation, addWorkingDirs = []) {
    if (isPathInProject(projectRoot, filePath) || isPathInAnyDirectory(projectRoot, filePath, addWorkingDirs)) {
        return operation === "read" ? "read-in-cwd" : "write-in-cwd";
    }
    if (isPathInAnyDirectory(projectRoot, filePath, ["/tmp", "/private/tmp"])) {
        return operation === "read" ? "read-in-tmp" : "write-in-tmp";
    }
    return operation === "read" ? "read-out-cwd" : "write-out-cwd";
}
function isPathInDirectory(projectRoot, filePath, directory) {
    const normalized = normalizeFilePath(filePath);
    const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
    const normalizedDirectory = normalizeFilePath(directory);
    const absoluteDirectory = isAbsoluteFilePath(normalizedDirectory)
        ? normalizedDirectory
        : path.resolve(projectRoot, normalizedDirectory);
    const relative = path.relative(path.resolve(absoluteDirectory), path.resolve(absolutePath));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function isPathInAnyDirectory(projectRoot, filePath, directories) {
    if (!directories?.length) {
        return false;
    }
    const normalized = normalizeFilePath(filePath);
    const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
    for (const directory of directories) {
        if (isPathInDirectory(projectRoot, absolutePath, directory)) {
            return true;
        }
    }
    return false;
}
export function hasUserPermissionReplies(value) {
    return Boolean((Array.isArray(value.permissions) && value.permissions.length > 0) ||
        (Array.isArray(value.alwaysAllows) && value.alwaysAllows.length > 0));
}
export function appendProjectPermissionAllows(projectRoot, scopes, options = {}) {
    if (!Array.isArray(scopes) || scopes.length === 0) {
        return;
    }
    const validScopes = new Set([
        "read-in-cwd",
        "read-in-tmp",
        "read-out-cwd",
        "write-in-cwd",
        "write-in-tmp",
        "write-out-cwd",
        "delete-in-cwd",
        "delete-out-cwd",
        "query-git-log",
        "mutate-git-log",
        "network",
        "mcp",
    ]);
    const nextScopes = scopes.filter((scope) => validScopes.has(scope));
    if (nextScopes.length === 0) {
        return;
    }
    const settingsPath = path.join(projectRoot, ".deepcode", "settings.json");
    let settings = {};
    try {
        if (fs.existsSync(settingsPath)) {
            const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                settings = parsed;
            }
        }
    }
    catch {
        settings = {};
    }
    const existingPermissions = settings.permissions;
    const permissions = existingPermissions
        ? { ...existingPermissions }
        : options.inheritedPermissions
            ? {
                allow: [...options.inheritedPermissions.allow],
                deny: [...options.inheritedPermissions.deny],
                ask: [...options.inheritedPermissions.ask],
                defaultMode: options.inheritedPermissions.defaultMode,
                ...((options.inheritedPermissions.addWorkingDirs?.length ?? 0) > 0
                    ? { addWorkingDirs: [...(options.inheritedPermissions.addWorkingDirs ?? [])] }
                    : {}),
            }
            : {};
    const currentAllow = Array.isArray(permissions.allow) ? permissions.allow : [];
    const allow = [...currentAllow];
    for (const scope of nextScopes) {
        if (!allow.includes(scope)) {
            allow.push(scope);
        }
    }
    const currentDeny = Array.isArray(permissions.deny) ? permissions.deny : undefined;
    const currentAsk = Array.isArray(permissions.ask) ? permissions.ask : undefined;
    const deny = currentDeny ? currentDeny.filter((scope) => !nextScopes.includes(scope)) : permissions.deny;
    const ask = currentAsk ? currentAsk.filter((scope) => !nextScopes.includes(scope)) : permissions.ask;
    const changed = allow.length !== currentAllow.length ||
        (currentDeny ? deny.length !== currentDeny.length : false) ||
        (currentAsk ? ask.length !== currentAsk.length : false);
    if (existingPermissions && !changed) {
        return;
    }
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify({
        ...settings,
        permissions: {
            ...permissions,
            deny,
            ask,
            allow,
        },
    }, null, 2)}\n`, "utf8");
}
export function normalizeAskPermissions(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const result = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const record = item;
        if (typeof record.toolCallId !== "string" || typeof record.name !== "string") {
            continue;
        }
        const scopes = Array.isArray(record.scopes)
            ? record.scopes.filter((scope) => isAskPermissionScope(scope))
            : [];
        result.push({
            toolCallId: record.toolCallId,
            scopes,
            name: record.name,
            command: typeof record.command === "string" ? record.command : record.name,
            description: typeof record.description === "string" ? record.description : undefined,
        });
    }
    return result.length > 0 ? result : undefined;
}
export function isAskPermissionScope(value) {
    return (value === "read-in-cwd" ||
        value === "read-in-tmp" ||
        value === "read-out-cwd" ||
        value === "write-in-cwd" ||
        value === "write-in-tmp" ||
        value === "write-out-cwd" ||
        value === "delete-in-cwd" ||
        value === "delete-out-cwd" ||
        value === "query-git-log" ||
        value === "mutate-git-log" ||
        value === "network" ||
        value === "mcp" ||
        value === "unknown");
}
