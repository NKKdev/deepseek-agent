import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { type MultimodalMode } from "./model-capabilities";
import type { SessionMessage } from "../session";
export type OpenAIMessageConverterOptions = {
    /** Optional callback to render the /init command prompt template. */
    renderInitPrompt?: () => string;
};
/**
 * Converts internal SessionMessage arrays into OpenAI ChatCompletionMessageParam arrays.
 *
 * Handles:
 * - Tool-call / tool-result pairing with interrupt backfill
 * - Thinking-mode reasoning_content injection
 * - Multimodal content (images) filtering by model capability
 * - Compaction filtering
 */
export declare class OpenAIMessageConverter {
    private readonly options;
    constructor(options?: OpenAIMessageConverterOptions);
    /**
     * Build the OpenAI messages array from session messages, applying compaction
     * filtering, tool pairing, and format conversion.
     */
    buildMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string, multimodal?: MultimodalMode): ChatCompletionMessageParam[];
    /**
     * Returns the trailing assistant message with pending (unexecuted) tool calls,
     * if one exists at the end of the conversation.
     */
    getTrailingPendingToolCallMessage(messages: SessionMessage[]): {
        message: SessionMessage;
        toolCalls: unknown[];
    } | {
        message: null;
        toolCalls: [];
    };
    private convertMessage;
    private renderContent;
    private buildAnswersSystemMessage;
    private pairToolMessages;
    private findPairableToolMessageIndex;
    private getAssistantToolCalls;
    private getToolCallId;
    private getToolMessageCallId;
    private buildToolPairingKey;
    private isInterruptedToolMessage;
    private buildInterruptedOpenAIToolMessage;
    /** Exposed for use by appendToolMessages in SessionManager. */
    findToolFunction(toolCalls: unknown[], toolCallId: string): unknown | null;
    private buildInterruptedToolResult;
}
//# sourceMappingURL=openai-message-converter.d.ts.map