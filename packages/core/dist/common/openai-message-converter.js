import { supportsMultimodal } from "./model-capabilities.js";
const ANSWERS_SYSTEM_MESSAGE = "User has answered your questions. You can now continue with the user's answers in mind.";
/**
 * Converts internal SessionMessage arrays into OpenAI ChatCompletionMessageParam arrays.
 *
 * Handles:
 * - Tool-call / tool-result pairing with interrupt backfill
 * - Thinking-mode reasoning_content injection
 * - Multimodal content (images) filtering by model capability
 * - Compaction filtering
 */
export class OpenAIMessageConverter {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * Build the OpenAI messages array from session messages, applying compaction
     * filtering, tool pairing, and format conversion.
     */
    buildMessages(messages, thinkingEnabled, model, multimodal = "default") {
        const activeMessages = messages.filter((message) => !message.compacted);
        const toolPairings = this.pairToolMessages(activeMessages);
        const openAIMessages = [];
        for (let index = 0; index < activeMessages.length; index += 1) {
            const message = activeMessages[index];
            if (message.role === "tool") {
                continue;
            }
            openAIMessages.push(this.convertMessage(message, thinkingEnabled, model, multimodal));
            if (message.role === "user" && message.meta?.isAnswers) {
                openAIMessages.push(this.convertMessage(this.buildAnswersSystemMessage(message), thinkingEnabled, model, multimodal));
            }
            const toolCalls = this.getAssistantToolCalls(message);
            if (toolCalls.length === 0) {
                continue;
            }
            for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
                const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
                if (!toolCallId) {
                    continue;
                }
                const pairedToolIndex = toolPairings.get(this.buildToolPairingKey(index, toolCallIndex));
                if (pairedToolIndex != null) {
                    openAIMessages.push(this.convertMessage(activeMessages[pairedToolIndex], thinkingEnabled, model, multimodal));
                    continue;
                }
                openAIMessages.push(this.buildInterruptedOpenAIToolMessage(toolCalls, toolCallId));
            }
        }
        return openAIMessages;
    }
    /**
     * Returns the trailing assistant message with pending (unexecuted) tool calls,
     * if one exists at the end of the conversation.
     */
    getTrailingPendingToolCallMessage(messages) {
        const activeMessages = messages.filter((message) => !message.compacted);
        const latestMessage = activeMessages[activeMessages.length - 1];
        if (!latestMessage || latestMessage.role !== "assistant") {
            return { message: null, toolCalls: [] };
        }
        const toolCalls = this.getAssistantToolCalls(latestMessage);
        if (toolCalls.length === 0) {
            return { message: null, toolCalls: [] };
        }
        return {
            message: latestMessage,
            toolCalls: toolCalls.filter((toolCall) => Boolean(this.getToolCallId(toolCall))),
        };
    }
    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------
    convertMessage(message, thinkingEnabled, model, multimodal = "default") {
        const content = this.renderContent(message);
        const base = {
            role: message.role,
            content,
        };
        const messageParams = message.messageParams;
        if (messageParams?.tool_calls) {
            base.tool_calls = messageParams.tool_calls;
        }
        if (messageParams?.tool_call_id) {
            base.tool_call_id = messageParams.tool_call_id;
        }
        if (typeof messageParams?.reasoning_content === "string") {
            base.reasoning_content = messageParams.reasoning_content;
        }
        else if (thinkingEnabled && message.role === "assistant") {
            // Thinking-mode providers require every replayed assistant message
            // to include the reasoning_content field, even when it is empty.
            base.reasoning_content = "";
        }
        if ((message.role === "user" || message.role === "system") && message.contentParams) {
            const contentParts = [];
            if (content) {
                contentParts.push({ type: "text", text: content });
            }
            const params = Array.isArray(message.contentParams) ? message.contentParams : [message.contentParams];
            for (const param of params) {
                const part = param;
                if (part && (part.type !== "image_url" || supportsMultimodal(model, multimodal))) {
                    contentParts.push(part);
                }
            }
            const contentValue = contentParts.length > 0 ? contentParts : content;
            base.content = contentValue;
        }
        return base;
    }
    renderContent(message) {
        if (message.role === "user" && message.content === "/init") {
            return this.options.renderInitPrompt?.() ?? "";
        }
        return message.content ?? "";
    }
    buildAnswersSystemMessage(message) {
        return {
            id: `${message.id}:answers`,
            sessionId: message.sessionId,
            role: "system",
            content: ANSWERS_SYSTEM_MESSAGE,
            contentParams: null,
            messageParams: null,
            compacted: false,
            visible: false,
            createTime: message.createTime,
            updateTime: message.updateTime,
        };
    }
    pairToolMessages(messages) {
        const pairings = new Map();
        const usedToolMessageIndexes = new Set();
        for (let assistantIndex = 0; assistantIndex < messages.length; assistantIndex += 1) {
            const toolCalls = this.getAssistantToolCalls(messages[assistantIndex]);
            for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
                const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
                if (!toolCallId) {
                    continue;
                }
                const toolIndex = this.findPairableToolMessageIndex(messages, assistantIndex, toolCallId, usedToolMessageIndexes);
                if (toolIndex == null) {
                    continue;
                }
                usedToolMessageIndexes.add(toolIndex);
                pairings.set(this.buildToolPairingKey(assistantIndex, toolCallIndex), toolIndex);
            }
        }
        return pairings;
    }
    findPairableToolMessageIndex(messages, assistantIndex, toolCallId, usedToolMessageIndexes) {
        let firstMatchingIndex = null;
        for (let index = assistantIndex + 1; index < messages.length; index += 1) {
            const message = messages[index];
            if (message.role !== "tool" || usedToolMessageIndexes.has(index)) {
                continue;
            }
            const candidateToolCallId = this.getToolMessageCallId(message);
            if (candidateToolCallId !== toolCallId) {
                continue;
            }
            if (firstMatchingIndex == null) {
                firstMatchingIndex = index;
            }
            if (!this.isInterruptedToolMessage(message)) {
                return index;
            }
        }
        return firstMatchingIndex;
    }
    getAssistantToolCalls(message) {
        if (message.role !== "assistant") {
            return [];
        }
        const messageParams = message.messageParams;
        return Array.isArray(messageParams?.tool_calls) ? messageParams.tool_calls : [];
    }
    getToolCallId(toolCall) {
        if (!toolCall || typeof toolCall !== "object") {
            return null;
        }
        const id = toolCall.id;
        return typeof id === "string" && id ? id : null;
    }
    getToolMessageCallId(message) {
        const messageParams = message.messageParams;
        const toolCallId = messageParams?.tool_call_id;
        return typeof toolCallId === "string" && toolCallId ? toolCallId : null;
    }
    buildToolPairingKey(assistantIndex, toolCallIndex) {
        return `${assistantIndex}:${toolCallIndex}`;
    }
    isInterruptedToolMessage(message) {
        if (typeof message.content !== "string" || !message.content.trim()) {
            return false;
        }
        try {
            const parsed = JSON.parse(message.content);
            return parsed.metadata?.interrupted === true;
        }
        catch {
            return false;
        }
    }
    buildInterruptedOpenAIToolMessage(toolCalls, toolCallId) {
        const toolFunction = this.findToolFunction(toolCalls, toolCallId);
        return {
            role: "tool",
            content: this.buildInterruptedToolResult(toolFunction, "Previous tool call did not complete."),
            tool_call_id: toolCallId,
        };
    }
    /** Exposed for use by appendToolMessages in SessionManager. */
    findToolFunction(toolCalls, toolCallId) {
        for (const toolCall of toolCalls) {
            if (!toolCall || typeof toolCall !== "object") {
                continue;
            }
            const record = toolCall;
            if (record.id === toolCallId) {
                return record.function ?? null;
            }
        }
        return null;
    }
    buildInterruptedToolResult(toolFunction, reason) {
        const toolName = toolFunction && typeof toolFunction === "object" && typeof toolFunction.name === "string"
            ? toolFunction.name
            : "tool";
        return JSON.stringify({
            ok: false,
            name: toolName,
            error: reason,
            metadata: {
                interrupted: true,
            },
        }, null, 2);
    }
}
