import { ChunkProcessor } from "./chunk_processor.mjs";
import { generateRandomString } from "./common.mjs";
import { pathToFileURL } from "node:url";

const apiName = "openai-completions";
const providerName = "llama.cpp";
const modelName = "Qwen3.8-27B-UD-Q3_K_XL";
const baseUrl = "http://10.0.2.2:8080/v1";
const contextWindow = 262144;

// canned reply for prompts not listed in the scenarios table,
// so that every prompt always settles
const defaultThinkText = "I need to say hi";
const defaultText = "Hi!";

export class MockPiProcess {

    write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
    turnMessage;
    turnToolResults = [];
    agentMessages = [];
    sessionMessages = [];
    userMessageCount = 0;

    constructor(write) {
        if (write) {
            this.write = write;
        }
    }

    writeObj(obj) {
        this.write(obj);
    }

    // pi process writes this on startup, so simulate it too
    startup() {
        this.writeObj({
            type: "extension_ui_request",
            id: "bd03171a-2bc7-4c86-b555-96698513b1dc",
            method: "setStatus",
            statusKey: "goal"
        });
    }

    handle(record) {
        if (record.type === "get_state") {
            this.sendState(record.id);
        } else if (record.type === "prompt") {
            this.promptResponse(record.id, record.message);
            runScenario(this, record.message);
            this.endTurn();
            this.endAgent();
            this.settle();
        }
    }

    sendState(id) {
        this.writeObj({
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

    promptResponse(id, message) {
        this.writeObj({
            id: id,
            type: "response",
            command: "prompt",
            success: true,
            data: {
                disposition: "started"
            }
        });

        this.writeObj({ type: "agent_start" });
        this.writeObj({ type: "turn_start" });

        if (this.userMessageCount === 0) {
            let systemMessage = {
                role: "system",
                content: "",
                sections: {
                    preamble: "You are a coding assistant running inside pi",
                },
                timestamp: Date.now(),
                toolsAdded: []
            };
            this.writeObj({ type: "message_start", message: systemMessage });
            systemMessage.timestamp = Date.now();
            this.writeObj({ type: "message_end", message: systemMessage });
            this.agentMessages.push(systemMessage);
            this.sessionMessages.push(systemMessage);
        }

        let userMessage = {
            role: "user",
            content: [{ type: "text", text: message }],
            timestamp: Date.now()
        };
        this.writeObj({ type: "message_start", message: userMessage });
        userMessage.timestamp = Date.now();
        this.writeObj({ type: "message_end", message: userMessage });
        this.userMessageCount++;
        this.agentMessages.push(userMessage);
        this.sessionMessages.push(userMessage);
    }

    thinkWithToolCall(thinkText, toolName, toolArgs, toolText) {
        const toolCallId = generateRandomString(32);
        const responseId = `chatcmpl-${generateRandomString(32)}`;

        // message start
        this.writeObj({
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
        this.writeObj({
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
            this.writeObj({
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
        this.writeObj({
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
            this.writeObj({
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
        this.writeObj({
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
        this.writeObj({
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
        this.turnMessage = message;
        this.writeObj({
            type: "message_end",
            message: message
        });
        this.agentMessages.push(message);
        this.sessionMessages.push(message);

        return toolCallId;
    }

    toolExecute(toolCallId, toolName, toolArgs, toolResult) {
        // tool_execution_start
        this.writeObj({
            type: "tool_execution_start",
            toolCallId: toolCallId,
            toolName: toolName,
            args: toolArgs
        });

        // tool_execution_update
        const toolResultLines = toolResult.split("\n");
        let lineBuffer = "";
        this.writeObj({
            type: "tool_execution_update",
            toolCallId: toolCallId,
            toolName: toolName,
            args: toolArgs,
            partialResult: { content: [] } // first update has no details
        });
        for (const line of toolResultLines) {
            lineBuffer += `${line}\n`;
            this.writeObj({
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
        this.writeObj({
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
        
        this.writeObj({ type: "message_start", message: toolResultMessage });
        toolResultMessage.timestamp = Date.now();
        this.writeObj({ type: "message_end", message: toolResultMessage });
        this.agentMessages.push(toolResultMessage);
        this.sessionMessages.push(toolResultMessage);

        this.turnToolResults.push(toolResultMessage);
    }

    sendMessage(thinkText, messageText) {
        const responseId = `chatcmpl-${generateRandomString(32)}`;

        // message start
        this.writeObj({
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
        this.writeObj({
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
            this.writeObj({
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
        this.writeObj({
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
            this.writeObj({
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
        this.writeObj({
            type: "message_update",
            usage: {},
            assistantMessageEvent: {
                type: "thinking_end",
                contentIndex: 0,
                content: thinkText
            }
        });

        // text end
        this.writeObj({
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
        this.turnMessage = message;
        this.writeObj({
            type: "message_end",
            message: message
        });
        this.agentMessages.push(message);
        this.sessionMessages.push(message);
    }

    endTurn() {
        this.writeObj({
            type: "turn_end",
            message: this.turnMessage,
            toolResults: this.turnToolResults
        });
        this.turnMessage = null;
        this.turnToolResults.length = 0;
    }

    endAgent() {
        this.writeObj({
            type: "agent_end",
            messages: this.agentMessages,
            willRetry: false
        });
        this.agentMessages.length = 0;
    }

    settle() {
        this.writeObj({
            type: "agent_settled",
            aborted: false
        });
    }
}

// prompt text -> scenario function (receives the mock, emits its stream)
const scenarios = {
    "Hello": (m) => m.sendMessage(defaultThinkText, defaultText),
    "Hello tool": (m) => {
        const toolCallId = m.thinkWithToolCall(
            "I should list the directory",
            "bash",
            { command: "ls" },
            JSON.stringify({ command: "ls" })
        );
        m.toolExecute(toolCallId, "bash", { command: "ls" }, "line1\nline2");
        m.sendMessage("The command finished", "Here is the result.");
    }
};

function runScenario(m, message) {
    const scenario = scenarios[message];
    if (scenario) {
        scenario(m);
    } else {
        m.sendMessage(defaultThinkText, defaultText);
    }
}

// CLI mode: run as a standalone mock pi rpc process (node rpc-process.mjs)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const mock = new MockPiProcess();
    mock.startup();
    const chunkProcessor = new ChunkProcessor();
    process.stdin.on("data", (chunk) => {
        for (const record of chunkProcessor.getRecords(chunk)) {
            mock.handle(record);
        }
    });
}
