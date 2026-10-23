export type ShellKind = "bash" | "zsh" | "unknown";
type WindowsGitBashLookup = {
    findExecutableCandidates: (executable: string) => string[];
    findGitExecPath: () => string | null;
    existsSync: (candidate: string) => boolean;
};
export declare function setShellIfWindows(): void;
export declare function findGitBashPath(): string;
export declare function resolveWindowsGitBashPath(lookup: WindowsGitBashLookup): string | null;
export declare function resolveShellPath(): string;
export declare function getShellKind(shellPath: string): ShellKind;
export declare function buildShellInitCommand(shellPath: string): string | null;
export declare function buildDisableExtglobCommand(shellPath: string): string | null;
export declare function rewriteWindowsNullRedirect(command: string): string;
export declare function windowsPathToPosixPath(windowsPath: string): string;
export declare function posixPathToWindowsPath(posixPath: string): string;
export declare function toNativeCwd(shellCwd: string): string;
export declare function buildShellEnv(shellPath: string, extraEnv?: Record<string, string>): NodeJS.ProcessEnv;
export {};
//# sourceMappingURL=shell-utils.d.ts.map