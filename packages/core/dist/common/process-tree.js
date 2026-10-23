import { spawnSync } from "child_process";
export function killProcessTree(pid, signal = "SIGKILL", deps = {}) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    const platform = deps.platform ?? process.platform;
    const killPid = deps.killPid ?? ((targetPid, targetSignal) => process.kill(targetPid, targetSignal));
    if (platform === "win32") {
        const runTaskkill = deps.runTaskkill ?? runWindowsTaskkill;
        if (runTaskkill(pid)) {
            return true;
        }
        return killDirectProcess(pid, signal, killPid);
    }
    if (deps.killGroupOnNonWindows !== false && killDirectProcess(-pid, signal, killPid)) {
        return true;
    }
    return killDirectProcess(pid, signal, killPid);
}
export function runWindowsTaskkill(pid, spawnSyncImpl = spawnSync) {
    const result = spawnSyncImpl("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
    });
    return !result.error && result.status === 0;
}
function killDirectProcess(pid, signal, killPid) {
    try {
        killPid(pid, signal);
        return true;
    }
    catch {
        return false;
    }
}
