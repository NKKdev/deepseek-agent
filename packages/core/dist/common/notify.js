import { spawn } from "child_process";
export function formatDurationSeconds(durationMs) {
    const safeMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    return String(Math.floor(safeMs / 1000));
}
export function buildNotifyEnv(durationMs, baseEnv = process.env, context = {}) {
    const env = {
        ...baseEnv,
        DURATION: formatDurationSeconds(durationMs),
    };
    delete env.STATUS;
    delete env.FAIL_REASON;
    delete env.BODY;
    delete env.TITLE;
    if (context.status) {
        env.STATUS = context.status;
    }
    if (context.failReason) {
        env.FAIL_REASON = context.failReason;
    }
    if (context.body) {
        env.BODY = context.body;
    }
    if (context.title) {
        env.TITLE = context.title;
    }
    return env;
}
export function launchNotifyScript(notifyPath, durationMs, workingDirectory, spawnProcess = spawn, configuredEnv = {}, context = {}) {
    const commandPath = notifyPath?.trim();
    if (!commandPath) {
        return;
    }
    const options = {
        cwd: workingDirectory,
        detached: process.platform !== "win32",
        env: buildNotifyEnv(durationMs, { ...process.env, ...configuredEnv }, context),
        stdio: "ignore",
    };
    try {
        const child = spawnProcess(commandPath, [], options);
        child.once("error", (error) => {
            if (process.platform === "win32") {
                return;
            }
            if (error.code !== "EACCES" && error.code !== "ENOEXEC") {
                return;
            }
            // Fall back to /bin/sh so plain shell scripts still run without execute permissions.
            try {
                const fallbackChild = spawnProcess("/bin/sh", [commandPath], options);
                fallbackChild.once("error", () => undefined);
                fallbackChild.unref();
            }
            catch {
                // Ignore notification failures.
            }
        });
        child.unref();
    }
    catch {
        // Ignore notification failures.
    }
}
