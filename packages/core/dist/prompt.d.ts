import type { SessionMessage } from "./session";
import { type MultimodalMode } from "./common/model-capabilities";
export type PromptToolOptions = {
    model?: string;
    multimodal?: MultimodalMode;
    webSearchEnabled?: boolean;
    nonInteractive?: boolean;
};
export type SkillPromptDocument = {
    name: string;
    content: string;
    path?: string;
    skillFilePath?: string;
};
/** Read the dedicated prompt used when a submitted turn enters Plan Mode. */
export declare function getPlanModePrompt(): string;
export declare function buildSkillDocumentsPrompt(skills: SkillPromptDocument[]): string;
export declare function buildSkillCatalogPrompt(skills: Array<{
    name: string;
    description: string;
}>): string;
export declare function getSystemPrompt(_projectRoot: string, options?: PromptToolOptions): string;
export declare function getCompactPrompt(sessionMessages: SessionMessage[]): string;
export declare function getRuntimeContext(projectRoot: string, model?: string, addWorkingDirs?: string[]): string;
export declare function getExtensionRoot(): string;
export type ToolDefinition = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, unknown>;
            required?: string[];
            additionalProperties?: boolean;
        };
    };
};
export declare function getTools(_options?: PromptToolOptions, externalTools?: ToolDefinition[]): ToolDefinition[];
//# sourceMappingURL=prompt.d.ts.map