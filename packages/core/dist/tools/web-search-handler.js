import { resolvePlusHost } from "../common/plus-subscription.js";
import { bindProcessAbort } from "../common/process-abort.js";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
const MAX_OUTPUT_CHARS = 30000;
const MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
const WEB_SEARCH_TOOL_ACTIVITY_PREFIX = "WebSearch:";
export async function handleWebSearchTool(args, context) {
    context.signal?.throwIfAborted();
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) {
        return {
            ok: false,
            name: "WebSearch",
            error: 'Missing required "query" string.',
        };
    }
    const llmContext = context.createOpenAIClient?.();
    const scriptPath = llmContext?.webSearchTool?.trim();
    if (scriptPath) {
        return executeConfiguredWebSearch(query, scriptPath, context, llmContext?.env ?? {});
    }
    if (!hasUsableClient(llmContext)) {
        return {
            ok: false,
            name: "WebSearch",
            error: "WebSearch default mode requires a valid LLM configuration in ~/.deepcode/settings.json or ./.deepcode/settings.json.",
        };
    }
    return executeDefaultWebSearch(query, { ...llmContext, signal: context.signal }, context);
}
function hasUsableClient(value) {
    return Boolean(value?.client);
}
async function executeConfiguredWebSearch(query, scriptPath, context, configuredEnv) {
    context.signal?.throwIfAborted();
    const execution = await runWebSearchScript(scriptPath, query, context, configuredEnv);
    context.signal?.throwIfAborted();
    const output = execution.stdout.slice(0, MAX_OUTPUT_CHARS);
    const truncated = execution.stdout.length > MAX_OUTPUT_CHARS;
    if (execution.error) {
        return {
            ok: false,
            name: "WebSearch",
            error: execution.error,
            output: output || undefined,
            metadata: {
                exitCode: execution.exitCode,
                signal: execution.signal,
                stderr: execution.stderr || undefined,
                truncated,
            },
        };
    }
    if (execution.exitCode !== 0 || execution.signal !== null) {
        return {
            ok: false,
            name: "WebSearch",
            error: buildCommandError(execution.exitCode, execution.signal),
            output: output || undefined,
            metadata: {
                exitCode: execution.exitCode,
                signal: execution.signal,
                stderr: execution.stderr || undefined,
                truncated,
            },
        };
    }
    return {
        ok: true,
        name: "WebSearch",
        output: output || undefined,
        metadata: {
            exitCode: execution.exitCode,
            signal: execution.signal,
            truncated,
            stderr: execution.stderr || undefined,
        },
    };
}
async function executeDefaultWebSearch(query, llmContext, context) {
    context.signal?.throwIfAborted();
    try {
        const prepared = await prepareSearchQuery(query, llmContext);
        context.signal?.throwIfAborted();
        const output = await runDefaultWebSearchRequest(prepared.resolvedQuery, llmContext.machineId, llmContext.plusApiKey, context);
        return {
            ok: true,
            name: "WebSearch",
            output,
            metadata: {
                originalQuery: query,
                resolvedQuery: prepared.resolvedQuery,
                translated: prepared.translated,
                dominantLanguage: prepared.decision.dominantLanguage,
                languageReason: prepared.decision.reason,
            },
        };
    }
    catch (error) {
        context.signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            name: "WebSearch",
            error: `WebSearch default mode failed: ${message}`,
        };
    }
}
async function runWebSearchScript(scriptPath, query, context, configuredEnv) {
    context.signal?.throwIfAborted();
    return new Promise((resolve) => {
        const child = spawn(scriptPath, [query], {
            cwd: context.projectRoot,
            detached: process.platform !== "win32",
            env: { ...process.env, ...configuredEnv },
            stdio: ["ignore", "pipe", "pipe"],
        });
        bindProcessAbort(child, context.signal);
        const pid = child.pid;
        if (typeof pid === "number") {
            context.onProcessStart?.(pid, formatWebSearchActivityLabel(query));
        }
        let stdout = "";
        let stderr = "";
        let error;
        child.stdout?.on("data", (chunk) => {
            stdout = appendChunk(stdout, chunk);
        });
        child.stderr?.on("data", (chunk) => {
            stderr = appendChunk(stderr, chunk);
        });
        child.on("error", (spawnError) => {
            error = spawnError.message;
        });
        child.on("close", (code, signal) => {
            if (typeof pid === "number") {
                context.onProcessExit?.(pid);
            }
            resolve({
                stdout,
                stderr,
                exitCode: typeof code === "number" ? code : null,
                signal: signal ?? null,
                error,
            });
        });
    });
}
async function prepareSearchQuery(query, llmContext) {
    const decision = await decideSearchLanguage(query, llmContext);
    const containsChinese = containsChineseChar(query);
    if (decision.dominantLanguage === "en" && containsChinese) {
        const translatedQuery = await translateQuery(query, "English", llmContext);
        if (translatedQuery) {
            return {
                resolvedQuery: translatedQuery,
                decision,
                translated: true,
            };
        }
    }
    if (decision.dominantLanguage === "zh" && !containsChinese) {
        const translatedQuery = await translateQuery(query, "Chinese", llmContext);
        if (translatedQuery) {
            return {
                resolvedQuery: translatedQuery,
                decision,
                translated: true,
            };
        }
    }
    return {
        resolvedQuery: query,
        decision,
        translated: false,
    };
}
function containsChineseChar(text) {
    return /[\u4e00-\u9fff]/.test(text);
}
async function decideSearchLanguage(query, llmContext) {
    const prompt = `Decide whether the topic below has more useful online material in English or Chinese.

Topic:
\`\`\`text
${query}
\`\`\`

Return strict JSON:
{"dominant_language":"en"|"zh","reason":"one short sentence"}
Do not include markdown or any extra text.`;
    const result = parseJsonResponse(await chat(llmContext, prompt));
    const dominantLanguage = result.dominant_language;
    if (dominantLanguage !== "en" && dominantLanguage !== "zh") {
        throw new Error(`Unexpected dominant language: ${String(dominantLanguage)}`);
    }
    return {
        dominantLanguage,
        reason: typeof result.reason === "string" ? result.reason : "",
    };
}
async function translateQuery(query, targetLanguage, llmContext) {
    const prompt = `Translate the query text below into ${targetLanguage}.

Requirements:
- Preserve product names, library names, API names, versions, and abbreviations when appropriate.
- Return only the translated query, without quotes or explanation.

Query:
\`\`\`text
${query}
\`\`\``;
    return stripCodeFence(await chat(llmContext, prompt))
        .trim()
        .replace(/^['"]|['"]$/g, "");
}
async function chat(llmContext, prompt) {
    llmContext.signal?.throwIfAborted();
    const response = await llmContext.client.chat.completions.create({
        model: llmContext.model,
        messages: [{ role: "user", content: prompt }],
    }, { signal: llmContext.signal });
    llmContext.signal?.throwIfAborted();
    const content = response.choices?.[0]?.message?.content;
    if (typeof content === "string") {
        return content.trim();
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => (typeof part.text === "string" ? part.text : ""))
            .join("\n")
            .trim();
    }
    return "";
}
function parseJsonResponse(text) {
    const cleaned = stripCodeFence(text).trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        }
        throw new Error(`Failed to parse JSON response: ${cleaned || "<empty>"}`);
    }
}
function stripCodeFence(text) {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
    return fenceMatch ? fenceMatch[1] : trimmed;
}
async function runDefaultWebSearchRequest(query, machineId, plusApiKey, context) {
    if (!machineId) {
        throw new Error("Missing vscode.env.machineId for the default WebSearch request.");
    }
    const activityId = `web-search-${randomUUID()}`;
    context.onProcessStart?.(activityId, formatWebSearchActivityLabel(query));
    try {
        const response = await fetch(`${resolvePlusHost(plusApiKey)}/api/plugin/web-search`, {
            method: "POST",
            signal: context.signal,
            headers: {
                "Content-Type": "application/json",
                Token: machineId,
                ...(plusApiKey ? { "PLUS-API-KEY": plusApiKey } : {}),
            },
            body: JSON.stringify({ query }),
        });
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`WebSearch API request failed with status ${response.status}${body ? `: ${body}` : ""}`);
        }
        context.signal?.throwIfAborted();
        const payload = (await response.json());
        context.signal?.throwIfAborted();
        if (payload.success !== true) {
            const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : "Unknown error";
            if (reason.includes("rate limit exceeded")) {
                context.onPluginRateLimitExceeded?.("WebSearch");
            }
            throw new Error(`WebSearch API failed: ${reason}`);
        }
        if (typeof payload.result === "string" && payload.result.trim()) {
            return payload.result.trim();
        }
    }
    finally {
        context.onProcessExit?.(activityId);
    }
    throw new Error("The web search response was empty.");
}
function appendChunk(existing, chunk) {
    if (existing.length >= MAX_CAPTURE_CHARS) {
        return existing;
    }
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const remaining = MAX_CAPTURE_CHARS - existing.length;
    return `${existing}${text.slice(0, remaining)}`;
}
function formatWebSearchActivityLabel(query) {
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    const maxQueryLength = 180;
    const clippedQuery = normalizedQuery.length > maxQueryLength ? `${normalizedQuery.slice(0, maxQueryLength - 3)}...` : normalizedQuery;
    return `${WEB_SEARCH_TOOL_ACTIVITY_PREFIX} ${clippedQuery}`;
}
function buildCommandError(exitCode, signal) {
    if (signal) {
        return `WebSearch command terminated by signal ${signal}.`;
    }
    if (exitCode !== null) {
        return `WebSearch command failed with exit code ${exitCode}.`;
    }
    return "WebSearch command failed.";
}
