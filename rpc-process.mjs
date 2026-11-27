import { ChunkProcessor } from "./chunk_processor.mjs";
import { generateRandomString } from "./common.mjs";

const apiName = "openai-completions";
const providerName = "llama.cpp";
const modelName = "Qwen3.8-27B-UD-Q3_K_XL";
const baseUrl = "http://10.0.2.2:8080/v1";
const contextWindow = 262144;

let turnMessage;
let turnToolResults = [];
let sessionMessages = [];

function writeObj(obj) {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const chunkProcessor = new ChunkProcessor();

function processInput(chunk) {
    const records = chunkProcessor.getRecords(chunk);
    for (const record of records) {
        if (record.type === "get_state") {
            sendState(record.id);
        } else if (record.type === "prompt") {
            promptResponse(record.id, record.message);
            sendMessage("I need to say hi", "Hi!");
            endTurn();
            endAgent();
            settle();
        }
    }
}

function sendState(id) {
    writeObj({
        id: id,
        type: "response",
        command: "get_state",
        success: true,
        data: {
            model: {
                id: modelName,
                name: modelName,
                api: apiName,
                provider: providerName,
                baseUrl: baseUrl,
                reasoning: true,
                thinkingLevelMap: {},
                input: ["text", "image"],
                cost: {},
                contextWindow: contextWindow,
                maxTokens: contextWindow,
                compat: {}
            },
            thinkingLevel: "medium",
            isStreaming: false,
            isCompacting: false,
            steeringMode: "all",
            followUpMode: "one-at-a-time",
            sessionId: "session-id",
            sessionFile: "/path/to/file.jsonl",
            autoCompactionEnabled: true,
            messageCount: 0,
            pendingMessageCount: 0
        }
    });
}

function promptResponse(id, message) {
    writeObj({
        id: id,
        type: "response",
        command: "prompt",
        success: true,
        data: {
            disposition: "started"
        }
    });

    writeObj({ type: "agent_start" });
    writeObj({ type: "turn_start" });

    let systemMessage = {
        role: "system",
        content: "",
        sections: {
            preamble: "You are a coding assistant running inside pi",
        },
        timestamp: Date.now(),
        toolsAdded: []
    };
    writeObj({ type: "message_start", message: systemMessage });
    systemMessage.timestamp = Date.now();
    writeObj({ type: "message_end", message: systemMessage });
    sessionMessages.push(systemMessage);

    let userMessage = {
        role: "user",
        content: [{ type: "text", text: message }],
        timestamp: Date.now()
    };
    writeObj({ type: "message_start", message: userMessage });
    userMessage.timestamp = Date.now();
    writeObj({ type: "message_end", message: userMessage });
    sessionMessages.push(userMessage);
}

function thinkWithToolCall(thinkText, toolName, toolArgs, toolText) {
    const toolCallId = generateRandomString(32);
    const responseId = `chatcmpl-${generateRandomString(32)}`;

    // message start
    writeObj({
        type: "message_start",
        message: {
            role: "assistant",
            content: [],
            api: apiName,
            provider: providerName,
            model: modelName,
            usage: {},
            stopReason: "pending",
            timestamp: Date.now()
        }   
    });

    // thinking start
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "thinking_start",
            contentIndex: 0
        }
    });

    // thinking delta
    const words = thinkText.split(" ");
    for (const word of words) {
        writeObj({
            type: "message_update",
            usage: {},
            assistantMessageEvent: {
                type: "thinking_delta",
                contentIndex: 0,
                delta: word
            }
        });
    }

    // toolcall start
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "toolcall_start",
            contentIndex: 1,
            id: toolCallId,
            toolName: toolName
        }
    });

    // toolcall delta
    const toolWords = toolText.split(" ");
    for (const word of toolWords) {
        writeObj({
            type: "message_update",
            usage: {},
            assistantMessageEvent: {
                type: "toolcall_delta",
                contentIndex: 1,
                delta: word
            }
        });
    }

    // thinking end
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "thinking_end",
            contentIndex: 0,
            content: thinkText
        }
    });

    const toolCall = {
        type: "toolCall",
        id: toolCallId,
        name: toolName,
        arguments: toolArgs
    };

    // toolcall end
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "toolcall_end",
            contentIndex: 1,
            toolCall: toolCall
        }
    });

    // message end
    const message = {
        role: "assistant",
        content: [
            {
                type: "thinking",
                thinking: thinkText,
                thinkingSignature: "reasoning_content"
            },
            toolCall
        ],
        api: apiName,
        provider: providerName,
        model: modelName,
        usage: {},
        stopReason: "toolUse",
        timestamp: Date.now(),
        responseId: responseId,
        rawStopReason: "tool_calls",
        durationMs: 0,
        thinkingLevel: "medium"
    }
    turnMessage = message;
    writeObj({
        type: "message_end",
        message: message
    });
    sessionMessages.push(message);

    return toolCallId;
}

function toolExecute(toolCallId, toolName, toolArgs, toolResult) {
    // tool_execution_start
    writeObj({
        type: "tool_execution_start",
        toolCallId: toolCallId,
        toolName: toolName,
        args: toolArgs
    });

    // tool_execution_update
    const toolResultLines = toolResult.split("\n");
    let lineBuffer = "";
    writeObj({
        type: "tool_execution_update",
        toolCallId: toolCallId,
        toolName: toolName,
        args: toolArgs,
        partialResult: { content: [] } // first update has no details
    });
    for (const line of toolResultLines) {
        lineBuffer += `${line}\n`;
        writeObj({
            type: "tool_execution_update",
            toolCallId: toolCallId,
            toolName: toolName,
            args: toolArgs,
            partialResult: {
                content: [
                    {
                        type: "text",
                        text: lineBuffer
                    }
                ],
                details: {}
            }
        });
    }

    // tool_execution_end
    writeObj({
        type: "tool_execution_end",
        toolCallId: toolCallId,
        toolName: toolName,
        result: {
            content: [
                {
                    type: "text",
                    text: toolResult
                }
            ],
            structuredContent: {
                output: toolResult,
                truncated: false,
                exit_code: 0,
                wall_time_seconds: 0
            }
        },
        isError: false,
        durationMs: 0
    });

    let toolResultMessage = {
        role: "toolResult",
        toolCallId: toolCallId,
        toolName: toolName,
        content: [
            {
                type: "text",
                text: toolResult
            }
        ],
        isError: false,
        durationMs: 0,
        timestamp: Date.now()
    }
    
    writeObj({ type: "message_start", message: toolResultMessage });
    toolResultMessage.timestamp = Date.now();
    writeObj({ type: "message_end", message: toolResultMessage });
    sessionMessages.push(toolResultMessage);

    turnToolResults.push(toolResultMessage);
}

function sendMessage(thinkText, messageText) {
    const responseId = `chatcmpl-${generateRandomString(32)}`;

    // message start
    writeObj({
        type: "message_start",
        message: {
            role: "assistant",
            content: [],
            api: apiName,
            provider: providerName,
            model: modelName,
            usage: {},
            stopReason: "pending",
            timestamp: Date.now()
        }   
    });

    // thinking start
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "thinking_start",
            contentIndex: 0
        }
    });

    // thinking delta
    const thinkWords = thinkText.split(" ");
    for (const word of thinkWords) {
        writeObj({
            type: "message_update",
            usage: {},
            assistantMessageEvent: {
                type: "thinking_delta",
                contentIndex: 0,
                delta: word
            }
        });
    }

    // text start
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "text_start",
            contentIndex: 1
        }
    });

    // text delta
    const textWords = messageText.split(" ");
    for (const word of textWords) {
        writeObj({
            type: "message_update",
            usage: {},
            assistantMessageEvent: {
                type: "text_delta",
                contentIndex: 1,
                delta: word
            }
        });
    }

    // thinking end
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "thinking_end",
            contentIndex: 0,
            content: thinkText
        }
    });

    // text end
    writeObj({
        type: "message_update",
        usage: {},
        assistantMessageEvent: {
            type: "text_end",
            contentIndex: 1,
            content: messageText
        }
    });

    // message end
    const message = {
        role: "assistant",
        content: [
            {
                type: "thinking",
                thinking: thinkText,
                thinkingSignature: "reasoning_content"
            },
            {
                type: "text",
                text: messageText
            }
        ],
        api: apiName,
        provider: providerName,
        model: modelName,
        usage: {},
        stopReason: "stop",
        timestamp: Date.now(),
        responseId: responseId,
        rawStopReason: "stop",
        durationMs: 0,
        thinkingLevel: "medium"
    }
    turnMessage = message;
    writeObj({
        type: "message_end",
        message: message
    });
    sessionMessages.push(message);
}

function endTurn() {
    writeObj({
        type: "turn_end",
        message: turnMessage,
        toolResults: turnToolResults
    });
    turnMessage = null;
    turnToolResults.length = 0;
}

function endAgent() {
    writeObj({
        type: "agent_end",
        messages: sessionMessages,
        willRetry: false
    });
}

function settle() {
    writeObj({
        type: "agent_settled",
        aborted: false
    });
}

// pi process writes this on startup, so simulate it too
const startupObj = {
    type: "extension_ui_request",
    id: "bd03171a-2bc7-4c86-b555-96698513b1dc",
    method: "setStatus",
    statusKey: "goal"
};
writeObj(startupObj);

process.stdin.on("data", processInput);

