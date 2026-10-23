import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pathWin32 from "path/win32";
const WINDOWS_GIT_LOCATIONS = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"];
const WINDOWS_BASH_LOCATIONS = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
const NUL_REDIRECT_REGEX = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g;
let cachedGitBashPath = null;
export function setShellIfWindows() {
    if (process.platform !== "win32") {
        return;
    }
    process.env.SHELL = findGitBashPath();
}
export function findGitBashPath() {
    if (cachedGitBashPath) {
        return cachedGitBashPath;
    }
    const bashPath = resolveWindowsGitBashPath({
        findExecutableCandidates: findAllWindowsExecutableCandidates,
        findGitExecPath,
        existsSync: fs.existsSync,
    });
    if (bashPath) {
        cachedGitBashPath = bashPath;
        return bashPath;
    }
    throw new Error("Deep Code on Windows requires Git Bash. Install Git for Windows, or ensure Git's bash.exe is available in PATH.");
}
export function resolveWindowsGitBashPath(lookup) {
    return firstExistingWindowsPath([
        ...lookup.findExecutableCandidates("bash"),
        ...WINDOWS_BASH_LOCATIONS,
        ...gitExecPathToBashCandidates(lookup.findGitExecPath()),
        ...lookup.findExecutableCandidates("git").flatMap(gitExecutableToBashCandidates),
    ], lookup.existsSync);
}
export function resolveShellPath() {
    if (process.platform === "win32") {
        return findGitBashPath();
    }
    const envShell = process.env.SHELL;
    if (envShell && getShellKind(envShell) !== "unknown") {
        return envShell;
    }
    return "/bin/bash";
}
export function getShellKind(shellPath) {
    const executable = shellPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
    if (executable === "bash" || executable === "bash.exe") {
        return "bash";
    }
    if (executable === "zsh" || executable === "zsh.exe") {
        return "zsh";
    }
    return "unknown";
}
export function buildShellInitCommand(shellPath) {
    switch (getShellKind(shellPath)) {
        case "zsh":
            return ['ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"', 'if [ -f "$ZSHRC" ]; then { . "$ZSHRC"; } >/dev/null 2>&1; fi'].join("; ");
        case "bash":
            return [
                'BASHRC="${BASH_ENV:-$HOME/.bashrc}"',
                'if [ -f "$BASHRC" ]; then { . "$BASHRC"; } >/dev/null 2>&1; fi',
            ].join("; ");
        default:
            return null;
    }
}
export function buildDisableExtglobCommand(shellPath) {
    switch (getShellKind(shellPath)) {
        case "bash":
            return "shopt -u extglob 2>/dev/null || true";
        case "zsh":
            return "setopt NO_EXTENDED_GLOB 2>/dev/null || true";
        default:
            return null;
    }
}
export function rewriteWindowsNullRedirect(command) {
    return command.replace(NUL_REDIRECT_REGEX, "$1/dev/null");
}
export function windowsPathToPosixPath(windowsPath) {
    if (windowsPath.startsWith("\\\\")) {
        return windowsPath.replace(/\\/g, "/");
    }
    const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\]/);
    if (driveMatch) {
        const driveLetter = driveMatch[1].toLowerCase();
        return `/${driveLetter}${windowsPath.slice(2).replace(/\\/g, "/")}`;
    }
    return windowsPath.replace(/\\/g, "/");
}
export function posixPathToWindowsPath(posixPath) {
    if (posixPath.startsWith("//")) {
        return posixPath.replace(/\//g, "\\");
    }
    const cygdriveMatch = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/);
    if (cygdriveMatch) {
        const driveLetter = cygdriveMatch[1].toUpperCase();
        const rest = posixPath.slice(`/cygdrive/${cygdriveMatch[1]}`.length);
        return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
    }
    const driveMatch = posixPath.match(/^\/([A-Za-z])(\/|$)/);
    if (driveMatch) {
        const driveLetter = driveMatch[1].toUpperCase();
        const rest = posixPath.slice(2);
        return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
    }
    return posixPath.replace(/\//g, "\\");
}
export function toNativeCwd(shellCwd) {
    if (process.platform !== "win32") {
        return shellCwd;
    }
    return posixPathToWindowsPath(shellCwd);
}
export function buildShellEnv(shellPath, extraEnv = {}) {
    const env = {
        ...process.env,
        ...extraEnv,
        SHELL: shellPath,
        GIT_EDITOR: "true",
    };
    if (process.platform === "win32") {
        const tmpdir = windowsPathToPosixPath(os.tmpdir());
        env.TMPDIR = tmpdir;
        env.TMPPREFIX = path.posix.join(tmpdir, "zsh");
    }
    return env;
}
function findAllWindowsExecutableCandidates(executable) {
    const extraCandidates = executable === "git" ? WINDOWS_GIT_LOCATIONS : executable === "bash" ? WINDOWS_BASH_LOCATIONS : [];
    try {
        const output = execFileSync("where.exe", [executable], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        });
        let whereResults = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        if (executable === "bash") {
            // Skip WSL's deprecated bash.exe launcher (C:\Windows\System32\bash.exe).
            // It would start commands inside the Linux distro instead of the Windows host,
            // breaking all path translations and tool invocations.
            whereResults = whereResults.filter((candidate) => !/system32[\\/]bash\.exe$/i.test(candidate));
        }
        return filterWindowsExecutableCandidates([...whereResults, ...extraCandidates]);
    }
    catch {
        return filterWindowsExecutableCandidates(extraCandidates);
    }
}
function findGitExecPath() {
    try {
        const output = execFileSync("git", ["--exec-path"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
        }).trim();
        return output || null;
    }
    catch {
        return null;
    }
}
function gitExecPathToBashCandidates(execPath) {
    if (!execPath) {
        return [];
    }
    const normalized = execPath.replace(/\//g, "\\");
    return [
        pathWin32.join(normalized, "..", "..", "..", "bin", "bash.exe"),
        pathWin32.join(normalized, "..", "..", "bin", "bash.exe"),
    ];
}
function gitExecutableToBashCandidates(gitPath) {
    return [pathWin32.join(gitPath, "..", "..", "bin", "bash.exe"), pathWin32.join(gitPath, "..", "bin", "bash.exe")];
}
function firstExistingWindowsPath(candidates, existsSync) {
    const seen = new Set();
    for (const candidate of candidates) {
        const normalized = pathWin32.resolve(candidate);
        const key = normalized.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        if (getShellKind(normalized) === "bash" && existsSync(normalized)) {
            return normalized;
        }
    }
    return null;
}
function filterWindowsExecutableCandidates(candidates) {
    const cwd = process.cwd().toLowerCase();
    const seen = new Set();
    const results = [];
    for (const candidate of candidates) {
        const normalized = path.resolve(candidate).toLowerCase();
        const candidateDir = path.dirname(normalized).toLowerCase();
        if (candidateDir === cwd || normalized.startsWith(`${cwd}${path.sep}`)) {
            continue;
        }
        if (!seen.has(normalized) && fs.existsSync(candidate)) {
            seen.add(normalized);
            results.push(candidate);
        }
    }
    return results;
}
