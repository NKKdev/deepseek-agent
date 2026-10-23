import * as fs from "fs";
import * as path from "path";
import { readTextFileWithMetadata } from "./file-utils.js";
import { posixPathToWindowsPath } from "./shell-utils.js";
const fileStatesBySession = new Map();
const snippetsBySession = new Map();
const snippetCountersBySession = new Map();
const fullFileSnippetCountersBySession = new Map();
const fileVersionsBySession = new Map();
export function clearSessionState(sessionId) {
    if (!sessionId) {
        return;
    }
    fileStatesBySession.delete(sessionId);
    snippetsBySession.delete(sessionId);
    snippetCountersBySession.delete(sessionId);
    fullFileSnippetCountersBySession.delete(sessionId);
    fileVersionsBySession.delete(sessionId);
}
export function hasSessionState(sessionId) {
    if (!sessionId) {
        return false;
    }
    return Boolean(fileStatesBySession.get(sessionId)?.size ||
        snippetsBySession.get(sessionId)?.size ||
        snippetCountersBySession.has(sessionId) ||
        fullFileSnippetCountersBySession.has(sessionId) ||
        fileVersionsBySession.get(sessionId)?.size);
}
export function normalizeFilePath(filePath, platform = process.platform) {
    const nativePath = normalizeNativeFilePath(filePath, platform);
    return platform === "win32" ? path.win32.normalize(nativePath) : path.normalize(nativePath);
}
export function normalizeNativeFilePath(filePath, platform = process.platform) {
    if (platform !== "win32") {
        return filePath;
    }
    if (isGitBashAbsolutePath(filePath)) {
        return posixPathToWindowsPath(filePath);
    }
    return filePath;
}
export function isAbsoluteFilePath(filePath, platform = process.platform) {
    const nativePath = normalizeNativeFilePath(filePath, platform);
    if (platform !== "win32") {
        return path.isAbsolute(nativePath);
    }
    const normalized = path.win32.normalize(nativePath);
    return path.win32.isAbsolute(normalized) && (/^[A-Za-z]:[\\/]/.test(normalized) || /^\\\\/.test(normalized));
}
function isGitBashAbsolutePath(filePath) {
    return /^\/[A-Za-z](?:\/|$)/.test(filePath) || /^\/cygdrive\/[A-Za-z](?:\/|$)/.test(filePath);
}
export function recordFileState(sessionId, state, options = {}) {
    if (!sessionId || !state.filePath) {
        return;
    }
    let sessionState = fileStatesBySession.get(sessionId);
    if (!sessionState) {
        sessionState = new Map();
        fileStatesBySession.set(sessionId, sessionState);
    }
    const normalizedPath = normalizeFilePath(state.filePath);
    const currentVersion = getFileVersion(sessionId, normalizedPath);
    const nextVersion = options.incrementVersion ? currentVersion + 1 : currentVersion;
    setFileVersion(sessionId, normalizedPath, nextVersion);
    sessionState.set(normalizedPath, {
        ...state,
        filePath: normalizedPath,
        version: nextVersion,
    });
}
export function markFileRead(sessionId, filePath, state = null) {
    if (!sessionId || !filePath) {
        return;
    }
    recordFileState(sessionId, {
        filePath,
        content: state?.content ?? "",
        timestamp: state?.timestamp ?? 0,
        offset: state?.offset,
        limit: state?.limit,
        isPartialView: state?.isPartialView,
        encoding: state?.encoding,
        lineEndings: state?.lineEndings,
    });
}
export function getFileState(sessionId, filePath) {
    if (!sessionId || !filePath) {
        return null;
    }
    return fileStatesBySession.get(sessionId)?.get(normalizeFilePath(filePath)) ?? null;
}
export function wasFileRead(sessionId, filePath) {
    return getFileState(sessionId, filePath) !== null;
}
export function getFileVersion(sessionId, filePath) {
    if (!sessionId || !filePath) {
        return 0;
    }
    return fileVersionsBySession.get(sessionId)?.get(normalizeFilePath(filePath)) ?? 0;
}
function setFileVersion(sessionId, filePath, version) {
    let sessionVersions = fileVersionsBySession.get(sessionId);
    if (!sessionVersions) {
        sessionVersions = new Map();
        fileVersionsBySession.set(sessionId, sessionVersions);
    }
    sessionVersions.set(normalizeFilePath(filePath), version);
}
export function isFullFileView(state) {
    return Boolean(state && !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined");
}
export function createSnippet(sessionId, filePath, startLine, endLine, preview) {
    const nextCounter = (snippetCountersBySession.get(sessionId) ?? 0) + 1;
    snippetCountersBySession.set(sessionId, nextCounter);
    return createSnippetWithId(sessionId, filePath, startLine, endLine, preview, `snippet_${nextCounter}`, "snippet");
}
export function createFullFileSnippet(sessionId, filePath, startLine, endLine, preview) {
    const nextCounter = fullFileSnippetCountersBySession.get(sessionId) ?? 0;
    fullFileSnippetCountersBySession.set(sessionId, nextCounter + 1);
    return createSnippetWithId(sessionId, filePath, startLine, endLine, preview, `full_file_${nextCounter}`, "full");
}
export function restoreSnippet(sessionId, snippet) {
    const restored = createSnippetWithId(sessionId, snippet.filePath, snippet.startLine, snippet.endLine, snippet.preview ?? "", snippet.id, snippet.scopeType ?? inferSnippetScopeType(snippet.id));
    if (restored) {
        updateSnippetCounters(sessionId, snippet.id);
    }
    return restored;
}
function createSnippetWithId(sessionId, filePath, startLine, endLine, preview, id, scopeType) {
    if (!sessionId || !filePath || startLine < 1 || endLine < startLine) {
        return null;
    }
    const snippet = {
        id,
        filePath: normalizeFilePath(filePath),
        startLine,
        endLine,
        preview,
        fileVersion: getFileVersion(sessionId, filePath),
        scopeType,
    };
    let snippets = snippetsBySession.get(sessionId);
    if (!snippets) {
        snippets = new Map();
        snippetsBySession.set(sessionId, snippets);
    }
    snippets.set(snippet.id, snippet);
    return snippet;
}
function inferSnippetScopeType(id) {
    return id.startsWith("full_file_") ? "full" : "snippet";
}
function updateSnippetCounters(sessionId, id) {
    const fullFileMatch = /^full_file_(\d+)$/.exec(id);
    if (fullFileMatch) {
        const nextCounter = Number(fullFileMatch[1]) + 1;
        const current = fullFileSnippetCountersBySession.get(sessionId) ?? 0;
        fullFileSnippetCountersBySession.set(sessionId, Math.max(current, nextCounter));
        return;
    }
    const snippetMatch = /^snippet_(\d+)$/.exec(id);
    if (snippetMatch) {
        const currentCounter = Number(snippetMatch[1]);
        const current = snippetCountersBySession.get(sessionId) ?? 0;
        snippetCountersBySession.set(sessionId, Math.max(current, currentCounter));
    }
}
export function getSnippet(sessionId, snippetId) {
    if (!sessionId || !snippetId) {
        return null;
    }
    return snippetsBySession.get(sessionId)?.get(snippetId) ?? null;
}
export function hasSnippetOutdatedFileVersion(sessionId, snippet) {
    return getFileVersion(sessionId, snippet.filePath) > snippet.fileVersion;
}
export function rebuildSessionStateFromHistory(sessionId, messages) {
    if (!sessionId || hasSessionState(sessionId)) {
        return;
    }
    for (const message of messages) {
        if (message.role !== "tool" || typeof message.content !== "string") {
            continue;
        }
        const result = parsePersistedToolResult(message.content);
        if (!result || result.ok !== true) {
            continue;
        }
        const metadata = asRecord(result.metadata);
        if (!metadata) {
            continue;
        }
        if (result.name === "read") {
            rebuildReadResult(sessionId, result, metadata);
        }
        else if (result.name === "edit") {
            rebuildEditResult(sessionId, metadata);
        }
        else if (result.name === "write") {
            rebuildWriteResult(sessionId, metadata);
        }
    }
}
function rebuildReadResult(sessionId, result, metadata) {
    const snippet = asRecord(metadata.snippet);
    if (!snippet) {
        return;
    }
    const restored = restoreSnippetFromRecord(sessionId, snippet, {
        idKey: "id",
        filePathKey: "filePath",
        startLineKey: "startLine",
        endLineKey: "endLine",
        preview: typeof result.output === "string" ? result.output : "",
    });
    if (!restored) {
        return;
    }
    refreshRebuiltFileState(sessionId, restored.filePath, {
        scopeType: restored.scopeType,
        startLine: restored.startLine,
        endLine: restored.endLine,
        incrementVersion: false,
    });
}
function rebuildEditResult(sessionId, metadata) {
    const scope = asRecord(metadata.scope);
    if (scope) {
        restoreSnippetFromRecord(sessionId, scope, {
            idKey: "snippet_id",
            filePathKey: "file_path",
            startLineKey: "start_line",
            endLineKey: "end_line",
            scopeType: metadata.read_scope_type === "full" ? "full" : undefined,
        });
    }
    const scopeFilePath = typeof scope?.file_path === "string" ? scope.file_path : undefined;
    rebuildCandidateSnippets(sessionId, metadata, scopeFilePath);
    const filePath = typeof metadata.file_path === "string" ? metadata.file_path : scopeFilePath;
    if (filePath && metadata.cache_refreshed === true) {
        refreshRebuiltFileState(sessionId, filePath, { incrementVersion: true });
    }
}
function rebuildWriteResult(sessionId, metadata) {
    if (metadata.cache_refreshed !== true || typeof metadata.file_path !== "string") {
        return;
    }
    refreshRebuiltFileState(sessionId, metadata.file_path, { incrementVersion: true });
}
function rebuildCandidateSnippets(sessionId, metadata, filePath) {
    if (!filePath) {
        return;
    }
    const candidates = Array.isArray(metadata.candidates) ? metadata.candidates : [];
    for (const candidate of candidates) {
        const record = asRecord(candidate);
        if (!record) {
            continue;
        }
        restoreSnippetFromRecord(sessionId, { ...record, file_path: filePath }, {
            idKey: "snippet_id",
            filePathKey: "file_path",
            startLineKey: "start_line",
            endLineKey: "end_line",
            scopeType: "snippet",
            preview: typeof record.preview === "string" ? record.preview : "",
        });
    }
    const closestMatch = asRecord(metadata.closest_match);
    if (closestMatch) {
        restoreSnippetFromRecord(sessionId, { ...closestMatch, file_path: filePath }, {
            idKey: "snippet_id",
            filePathKey: "file_path",
            startLineKey: "start_line",
            endLineKey: "end_line",
            scopeType: "snippet",
            preview: typeof closestMatch.preview === "string" ? closestMatch.preview : "",
        });
    }
}
function restoreSnippetFromRecord(sessionId, record, options) {
    const rawId = record[options.idKey];
    const rawFilePath = record[options.filePathKey];
    const id = typeof rawId === "string" ? rawId.trim() : "";
    const filePath = typeof rawFilePath === "string" ? normalizeFilePath(rawFilePath) : "";
    const startLine = toPositiveInteger(record[options.startLineKey]);
    const endLine = toPositiveInteger(record[options.endLineKey]);
    if (!id || !filePath || startLine === null || endLine === null) {
        return null;
    }
    return restoreSnippet(sessionId, {
        id,
        filePath,
        startLine,
        endLine,
        preview: options.preview,
        scopeType: options.scopeType,
    });
}
function refreshRebuiltFileState(sessionId, rawFilePath, options = {}) {
    const filePath = normalizeFilePath(rawFilePath);
    if (!filePath || !fs.existsSync(filePath)) {
        return;
    }
    try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            return;
        }
        const metadata = readTextFileWithMetadata(filePath);
        const isPartialView = options.scopeType === "snippet";
        const content = isPartialView
            ? metadata.content
                .split("\n")
                .slice((options.startLine ?? 1) - 1, options.endLine)
                .join("\n")
            : metadata.content;
        recordFileState(sessionId, {
            filePath,
            content,
            timestamp: metadata.timestamp,
            offset: isPartialView ? options.startLine : undefined,
            limit: isPartialView && options.startLine !== undefined && options.endLine !== undefined
                ? Math.max(1, options.endLine - options.startLine + 1)
                : undefined,
            isPartialView,
            encoding: metadata.encoding,
            lineEndings: metadata.lineEndings,
        }, { incrementVersion: options.incrementVersion });
    }
    catch {
        // Best-effort restore: later tool execution will return the precise filesystem error.
    }
}
function parsePersistedToolResult(content) {
    try {
        return asRecord(JSON.parse(content));
    }
    catch {
        return null;
    }
}
function asRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
}
function toPositiveInteger(value) {
    const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isInteger(numberValue) || numberValue < 1) {
        return null;
    }
    return numberValue;
}
