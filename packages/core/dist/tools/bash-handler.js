import { bindProcessAbort } from "../common/process-abort.js";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DEFAULT_BASH_TIMEOUT_MS, clampBashTimeoutMs } from "../common/bash-timeout.js";
import { killProcessTree } from "../common/process-tree.js";
import { buildDisableExtglobCommand, buildShellEnv, buildShellInitCommand, resolveShellPath, rewriteWindowsNullRedirect, toNativeCwd, } from "../common/shell-utils.js";
const MAX_OUTPUT_CHARS = 30000;
const MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
const BACKGROUND_OUTPUT_DIR = path.join(os.tmpdir(), "deepcode-background");
const TRAILING_BACKGROUND_OPERATOR_PATTERN = /(^|[^\\&])\s*&\s*$/;
const sessionWorkingDirs = new Map();
// Process completion and output EOF are separate: descendants may retain pipes.
// Bound output draining after exit, and completion after a timeout kill attempt.
const IO_DRAIN_TIMEOUT_MS = 2_000;
const HELD_PIPE_NOTE = "[deepcode] Output streams did not close within the drain deadline; later output may not have been collected. Use run_in_background: true for detached work.";
export function clearSessionWorkingDir(sessionId) {
    if (!sessionId) {
        return;
    }
    sessionWorkingDirs.delete(sessionId);
}
export async function handleBashTool(args, context) {
    context.signal?.throwIfAborted();
    const rawCommand = typeof args.command === "string" ? args.command : "";
    const runInBackground = isTrue(args.run_in_background);
    const command = runInBackground ? stripTrailingBackgroundOperator(rawCommand) : rawCommand;
    if (!command.trim()) {
        return {
            ok: false,
            name: "bash",
            error: 'Missing required "command" string.',
        };
    }
    const startCwd = getSessionCwd(context.sessionId, context.projectRoot);
    const { shellPath, shellArgs, marker } = buildShellCommand(command);
    if (runInBackground) {
        return startBackgroundShellCommand(shellPath, shellArgs, startCwd, command, marker, context);
    }
    const execution = await executeShellCommand(shellPath, shellArgs, startCwd, command, context);
    context.signal?.throwIfAborted();
    const result = buildToolCommandResult(execution.stdout, execution.stderr, marker, execution.exitCode, execution.signal, shellPath, startCwd, execution.timedOut, execution.timeoutMs, execution.deadlineAtMs);
    if (execution.outputDrainTimedOut) {
        result.output = `${result.output}${result.output && !result.output.endsWith("\n") ? "\n" : ""}${HELD_PIPE_NOTE}`;
    }
    updateSessionCwd(context.sessionId, startCwd, result.cwd);
    if (execution.timedOut || execution.error || result.exitCode !== 0 || result.signal !== null) {
        const errorMessage = buildErrorMessage(result.exitCode, result.signal, execution.error, execution.timedOut);
        return formatResult({ ...result, ok: false }, "bash", errorMessage);
    }
    return formatResult(result, "bash");
}
function isTrue(value) {
    return value === true || value === "true";
}
function stripTrailingBackgroundOperator(command) {
    return command.replace(TRAILING_BACKGROUND_OPERATOR_PATTERN, "$1").trimEnd();
}
function getSessionCwd(sessionId, fallback) {
    const stored = sessionWorkingDirs.get(sessionId);
    if (stored && isUsableCwd(stored)) {
        return stored;
    }
    // If the stored cwd is no longer valid (e.g. Git Bash's virtual /tmp path does not exist after Windows conversion),
    // fall back to projectRoot and clear the stale entry to prevent spawn ENOENT errors from breaking the bash tool.
    if (stored) {
        sessionWorkingDirs.delete(sessionId);
    }
    return fallback;
}
function updateSessionCwd(sessionId, fallback, cwd) {
    const nextCwd = cwd ?? fallback;
    // Only store valid directories; an invalid cwd (e.g. Git Bash's /tmp converted to \tmp) would cause the next spawn to fail.
    if (isUsableCwd(nextCwd)) {
        sessionWorkingDirs.set(sessionId, nextCwd);
    }
    else {
        sessionWorkingDirs.delete(sessionId);
    }
}
function isUsableCwd(cwd) {
    if (!cwd) {
        return false;
    }
    try {
        return fs.statSync(cwd).isDirectory();
    }
    catch {
        return false;
    }
}
function buildShellCommand(command) {
    const shellPath = resolveShellPath();
    const marker = buildMarker();
    const initCommand = buildShellInitCommand(shellPath);
    const disableExtglobCommand = buildDisableExtglobCommand(shellPath);
    const normalizedCommand = rewriteWindowsNullRedirect(command);
    // Git Bash mounts such as /tmp and /usr cannot be mapped by replacing
    // separators or drive prefixes. Ask Bash for the native path while it is alive.
    const cwdExpression = process.platform === "win32" ? '"$(builtin pwd -W)"' : '"$PWD"';
    const wrappedParts = [];
    if (initCommand) {
        wrappedParts.push(initCommand);
    }
    if (disableExtglobCommand) {
        wrappedParts.push(disableExtglobCommand);
    }
    wrappedParts.push(normalizedCommand, "__DEEPCODE_STATUS__=$?", `printf '%s%s\\n' "${marker}" ${cwdExpression}`, "exit $__DEEPCODE_STATUS__");
    const wrappedCommand = `{ ${wrappedParts.join("; ")}; } < /dev/null`;
    return { shellPath, shellArgs: ["-c", wrappedCommand], marker };
}
async function executeShellCommand(shellPath, shellArgs, cwd, command, context) {
    context.signal?.throwIfAborted();
    return new Promise((resolve) => {
        const detached = process.platform !== "win32";
        const configuredEnv = context.createOpenAIClient?.().env ?? {};
        const minTimeoutMs = context.bashMinTimeoutMs;
        const initialTimeoutMs = clampBashTimeoutMs(context.bashTimeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, minTimeoutMs);
        const startedAtMs = Date.now();
        let timeoutMs = initialTimeoutMs;
        let deadlineAtMs = startedAtMs + timeoutMs;
        let timedOut = false;
        let settled = false;
        let childExit = null;
        let stdout = "";
        let stderr = "";
        let error;
        let timeoutControlRegistered = false;
        let timeoutTimer = null;
        const child = spawn(shellPath, shellArgs, {
            cwd,
            env: buildShellEnv(shellPath, configuredEnv),
            detached,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        bindProcessAbort(child, context.signal);
        const pid = child.pid;
        const getTimeoutInfo = () => ({
            timeoutMs,
            startedAtMs,
            deadlineAtMs,
            timedOut,
        });
        const stopTimeoutTimer = () => {
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };
        let forceSettleTimer = null;
        const cancelForceSettleTimer = () => {
            if (forceSettleTimer) {
                clearTimeout(forceSettleTimer);
                forceSettleTimer = null;
            }
        };
        const unregisterTimeoutControl = () => {
            if (timeoutControlRegistered && typeof pid === "number") {
                timeoutControlRegistered = false;
                context.onProcessTimeoutControl?.(pid, null);
            }
        };
        const finish = (outputDrainTimedOut = false) => {
            if (settled) {
                return;
            }
            settled = true;
            cancelForceSettleTimer();
            stopTimeoutTimer();
            child.stdout?.destroy();
            child.stderr?.destroy();
            unregisterTimeoutControl();
            if (typeof pid === "number") {
                context.onProcessExit?.(pid);
            }
            resolve({
                stdout,
                stderr,
                exitCode: timedOut ? null : (childExit?.code ?? null),
                signal: timedOut ? null : (childExit?.signal ?? null),
                error,
                timedOut,
                timeoutMs,
                deadlineAtMs,
                outputDrainTimedOut,
            });
        };
        const startDrainTimer = () => {
            // An exit after timeout must not extend the original completion deadline.
            if (!forceSettleTimer) {
                forceSettleTimer = setTimeout(() => finish(Boolean((child.stdout && !child.stdout.readableEnded) || (child.stderr && !child.stderr.readableEnded))), IO_DRAIN_TIMEOUT_MS);
            }
        };
        const triggerTimeout = () => {
            if (settled || timedOut || childExit || typeof pid !== "number") {
                return;
            }
            timedOut = true;
            stopTimeoutTimer();
            startDrainTimer();
            unregisterTimeoutControl();
            // Unix process groups can outlive their leader. Regardless of kill success,
            // completion must not depend on either exit or pipe EOF arriving.
            killProcessTree(pid, "SIGKILL");
        };
        child.on("exit", (code, signal) => {
            if (settled || childExit) {
                return;
            }
            childExit = { code, signal };
            stopTimeoutTimer();
            startDrainTimer();
            unregisterTimeoutControl();
        });
        const scheduleTimeout = () => {
            stopTimeoutTimer();
            if (settled || timedOut || childExit) {
                return;
            }
            const remainingMs = Math.max(0, deadlineAtMs - Date.now());
            timeoutTimer = setTimeout(triggerTimeout, remainingMs);
        };
        const timeoutControl = {
            getInfo: getTimeoutInfo,
            setTimeoutMs: (nextTimeoutMs) => {
                if (settled || timedOut || childExit) {
                    return getTimeoutInfo();
                }
                timeoutMs = clampBashTimeoutMs(nextTimeoutMs, minTimeoutMs);
                deadlineAtMs = startedAtMs + timeoutMs;
                if (deadlineAtMs <= Date.now()) {
                    triggerTimeout();
                }
                else {
                    scheduleTimeout();
                }
                return getTimeoutInfo();
            },
        };
        child.stdout?.on("data", (chunk) => {
            if (settled)
                return;
            stdout = appendChunk(stdout, chunk);
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            context.onProcessStdout?.(pid, text);
        });
        child.stderr?.on("data", (chunk) => {
            if (settled)
                return;
            stderr = appendChunk(stderr, chunk);
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            context.onProcessStdout?.(pid, text);
        });
        child.on("error", (spawnError) => {
            if (settled)
                return;
            error = spawnError.message;
            finish();
        });
        child.on("close", (code, signal) => {
            if (settled)
                return;
            childExit ??= { code, signal };
            finish();
        });
        if (typeof pid === "number") {
            context.onProcessStart?.(pid, command);
            timeoutControlRegistered = true;
            context.onProcessTimeoutControl?.(pid, timeoutControl);
            scheduleTimeout();
        }
    });
}
function startBackgroundShellCommand(shellPath, shellArgs, cwd, command, marker, context) {
    context.signal?.throwIfAborted();
    fs.mkdirSync(BACKGROUND_OUTPUT_DIR, { recursive: true });
    const taskId = `bash-${randomUUID()}`;
    const outputPath = path.join(BACKGROUND_OUTPUT_DIR, `${taskId}.log`);
    const startedAtMs = Date.now();
    const detached = process.platform !== "win32";
    const configuredEnv = context.createOpenAIClient?.().env ?? {};
    const child = spawn(shellPath, shellArgs, {
        cwd,
        env: buildShellEnv(shellPath, configuredEnv),
        detached,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    });
    bindProcessAbort(child, context.signal);
    const pid = child.pid;
    const processId = typeof pid === "number" ? pid : -1;
    const stopCommand = typeof pid === "number" ? buildStopBackgroundProcessCommand(pid) : null;
    let stdout = "";
    let stderr = "";
    let error;
    const appendOutputFile = (chunk) => {
        try {
            fs.appendFileSync(outputPath, chunk);
        }
        catch {
            // Keep the background process running even if temp-file writes fail.
        }
    };
    if (typeof pid === "number") {
        context.onProcessStart?.(pid, command);
    }
    child.stdout?.on("data", (chunk) => {
        stdout = appendChunk(stdout, chunk);
        appendOutputFile(chunk);
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (typeof pid === "number") {
            context.onProcessStdout?.(pid, text);
        }
    });
    child.stderr?.on("data", (chunk) => {
        stderr = appendChunk(stderr, chunk);
        appendOutputFile(chunk);
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (typeof pid === "number") {
            context.onProcessStdout?.(pid, text);
        }
    });
    child.on("error", (spawnError) => {
        error = spawnError.message;
    });
    child.on("close", (code, signal) => {
        const markerResult = stripMarker(stdout, marker);
        const finalOutput = joinOutput(markerResult.output, stderr);
        const result = buildToolCommandResult(stdout, stderr, marker, typeof code === "number" ? code : null, signal ?? null, shellPath, cwd);
        if (!context.signal?.aborted)
            updateSessionCwd(context.sessionId, cwd, result.cwd);
        writeFinalBackgroundOutput(outputPath, finalOutput);
        if (typeof pid === "number") {
            context.onProcessExit?.(pid);
        }
        const ok = !error && result.exitCode === 0 && result.signal === null;
        context.onBackgroundProcessComplete?.({
            taskId,
            processId,
            command,
            outputPath,
            ok,
            exitCode: result.exitCode,
            signal: result.signal,
            error: ok ? undefined : buildErrorMessage(result.exitCode, result.signal, error),
            cwd: result.cwd,
            shellPath,
            startedAtMs,
            completedAtMs: Date.now(),
        });
    });
    return {
        ok: true,
        name: "bash",
        output: buildBackgroundStartMessage(taskId, outputPath, stopCommand),
        metadata: {
            backgroundTaskId: taskId,
            processId: typeof pid === "number" ? pid : null,
            outputPath,
            stopCommand,
            cwd,
            shellPath,
            startCwd: cwd,
            runInBackground: true,
        },
    };
}
function buildBackgroundStartMessage(taskId, outputPath, stopCommand) {
    const parts = [`Command running in background with ID: ${taskId}.`];
    if (stopCommand) {
        parts.push(`Stop it with: ${stopCommand}`);
    }
    parts.push(`Output is being written to: ${outputPath}`);
    return parts.join(" ");
}
function buildStopBackgroundProcessCommand(processId) {
    if (process.platform === "win32") {
        return `cmd.exe /c "taskkill /PID ${processId} /T /F"`;
    }
    return `kill -- -${processId}`;
}
function writeFinalBackgroundOutput(outputPath, output) {
    try {
        fs.writeFileSync(outputPath, output ?? "", "utf8");
    }
    catch {
        // Ignore notification/output persistence failures; the tool result already returned.
    }
}
function appendChunk(existing, chunk) {
    if (existing.length >= MAX_CAPTURE_CHARS) {
        return existing;
    }
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const remaining = MAX_CAPTURE_CHARS - existing.length;
    return `${existing}${text.slice(0, remaining)}`;
}
function buildMarker() {
    const token = Math.random().toString(36).slice(2);
    return `__DEEPCODE_PWD__${token}__`;
}
function buildToolCommandResult(stdout, stderr, marker, exitCode, signal, shellPath, startCwd, timedOut = false, timeoutMs, deadlineAtMs) {
    const { output: cleanedStdout, cwd } = stripMarker(stdout, marker);
    const combined = joinOutput(cleanedStdout, stderr);
    const { text, truncated } = truncateOutput(combined);
    return {
        ok: !timedOut && exitCode === 0 && signal === null,
        output: text,
        cwd,
        exitCode,
        signal,
        truncated,
        shellPath,
        startCwd,
        timedOut,
        timeoutMs,
        deadlineAt: typeof deadlineAtMs === "number" ? new Date(deadlineAtMs).toISOString() : undefined,
    };
}
function stripMarker(stdout, marker) {
    if (!stdout) {
        return { output: "", cwd: null };
    }
    const lines = stdout.split(/\r?\n/);
    let markerIndex = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startsWith(marker)) {
            markerIndex = i;
            break;
        }
    }
    if (markerIndex === -1) {
        return { output: stdout, cwd: null };
    }
    const markerLine = lines[markerIndex];
    const shellCwd = markerLine.slice(marker.length).trim();
    const cwd = shellCwd ? toNativeCwd(shellCwd) : null;
    lines.splice(markerIndex, 1);
    return { output: lines.join("\n"), cwd };
}
function joinOutput(stdout, stderr) {
    const trimmedStdout = stdout ?? "";
    const trimmedStderr = stderr ?? "";
    if (trimmedStdout && trimmedStderr) {
        return `${trimmedStdout}\n${trimmedStderr}`;
    }
    return trimmedStdout || trimmedStderr;
}
function truncateOutput(output) {
    if (output.length <= MAX_OUTPUT_CHARS) {
        return { text: output, truncated: false };
    }
    return { text: output.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}
function buildErrorMessage(exitCode, signal, error, timedOut = false) {
    if (timedOut) {
        return "Command timed out.";
    }
    if (error) {
        return error;
    }
    if (signal) {
        return `Command terminated by signal ${signal}.`;
    }
    if (exitCode !== null) {
        return `Command failed with exit code ${exitCode}.`;
    }
    return "Command failed.";
}
function formatResult(result, name, errorMessage) {
    const metadata = {
        exitCode: result.exitCode,
        signal: result.signal,
        cwd: result.cwd,
        truncated: result.truncated,
        shellPath: result.shellPath,
        startCwd: result.startCwd,
    };
    if (typeof result.timedOut === "boolean") {
        metadata.timedOut = result.timedOut;
    }
    if (typeof result.timeoutMs === "number") {
        metadata.timeoutMs = result.timeoutMs;
    }
    if (result.deadlineAt) {
        metadata.deadlineAt = result.deadlineAt;
    }
    const outputValue = result.output ? result.output : undefined;
    return {
        ok: result.ok,
        name,
        output: outputValue,
        error: errorMessage,
        metadata,
    };
}
