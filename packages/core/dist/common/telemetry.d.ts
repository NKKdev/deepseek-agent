export type NewPromptReportOptions = {
    enabled: boolean;
    machineId?: string;
    plusApiKey?: string;
    timeoutMs?: number;
};
/**
 * Fire-and-forget report of a new prompt session.
 * Respects the `enabled` toggle: when disabled, the call is a no-op.
 */
export declare function reportNewPrompt(options: NewPromptReportOptions): void;
//# sourceMappingURL=telemetry.d.ts.map