import { spawn } from 'child_process';
import { FileLogger } from './file_logger.mjs';
import { EventEmitter } from 'events';
import { ChunkProcessor } from './chunk_processor.mjs';
import { rpcCall } from './common.mjs';

export class Session {

    TOOL_MAX_LINE_SIZE = 65;

    sessionPath;
    chunkProcessor;
    piProcess;
    sessionType;
    settled = false;
    exited = false;
    steerCount = 0;
    messages = [];
    eventEmitter = new EventEmitter();
    terminalLogger;
    fileLogger;
    rpcCallId = 0;
    newSessionPending = false;

    // these record types are not fully logged because their data is
    // already contained in other types
    lightRecords = [
        "message_start",
        "turn_end",
        "agent_end",
        "tool_execution_end",
    ];

    // to avoid spamming log file on every streamed chunk
    skippedRecords = [
        "message_update"
    ];

    excludeTools = [
        "ask_user_question"
    ];

    limitString(str, max_size) {
        let result = str;
        if (str && max_size > 3 && str.length > max_size) {
            result = str.substring(0, max_size - 3);
            result += "...";
        }
        return result;
    }

    constructor(sessionType, terminalLogger, fileLogger, excludeTools) {

        this.sessionType = sessionType;
        this.terminalLogger = terminalLogger;
        this.fileLogger = fileLogger;
        if (excludeTools) {
            this.excludeTools = excludeTools;
        }

        // start the Pi process in RPC mode
        this.piProcess = spawn(
            'pi',
            [
                '--mode', 'rpc',
                '--exclude-tools', this.excludeTools.join(","),
            ],
            { stdio: ['pipe', 'pipe', 'inherit'] } // stdout is for protocol, stderr goes to console 
        );
        if (!this.piProcess.stdin || !this.piProcess.stdout) {
            throw new Error(`Failed to initialize ${this.sessionType} process streams.`);
        }

        // event setup
        this.chunkProcessor = new ChunkProcessor(this.terminalLogger);
        this.piProcess.stdout.on('data', (chunk) => this.onDataArrive(chunk));
        this.piProcess.on('close', (code, signal) => { this.onClose(code, signal); });
        this.piProcess.on('error', (err) => { this.onError(err); });
    }

    async start() {
        this.sessionPath = await this.getSessionPath();
    }

    async sendPrompt(text, id) {
        const args = {
            id: id,
            type: "prompt",
            message: text
        };
        await this.rpcCall(args);
    }

    async rpcCall(args, timeoutMs = 10 * 60 * 1000) {
        if (!args.id) {
            args.id = `rpc-${++this.rpcCallId}`;
        }
        if (this.exited) {
            throw new Error(`RPC call failed (${args.type}): session already exited`);
        }
        return await rpcCall(this.piProcess, args, timeoutMs);
    }

    async getSessionPath() {
        const args = {
            type: "get_state"
        };
        return (await this.rpcCall(args)).sessionFile;
    }

    onDataArrive(chunk) {
        const records = this.chunkProcessor.getRecords(chunk);
        for (const record of records) {
            // some records are skipped, some only logged minimally
            // this is to avoid log file grow large
            if (this.fileLogger) {
                if (!this.skippedRecords.includes(record.type)) {
                    if (!this.lightRecords.includes(record.type)) {
                        this.fileLogger.writeLine(JSON.stringify(record));
                    } else {
                        this.fileLogger.writeLine(`{"type": "${record.type}"}`);
                    }
                }
            }

            if (record.type === 'message_update') {
                const amEvent = record.assistantMessageEvent;
                if (amEvent && amEvent.type === 'thinking_start') {
                    this.terminalLogger.logDim(`[${this.sessionType}]: thinking...`);
                } else if (amEvent && amEvent.type === 'text_start') {
                    this.terminalLogger.logDim(`[${this.sessionType}]: writing message...`);
                }
            } else if (record.type === "tool_execution_start") {
                const toolName = record.toolName;
                if (Object.keys(record.args).length === 1) {
                    const argName = Object.keys(record.args)[0];
                    const argValue = record.args[argName];
                    const toolStr = `[${this.sessionType}]: ${toolName}: ${argName}: ${argValue}`;
                    const toolStrLimited = this.limitString(toolStr, this.TOOL_MAX_LINE_SIZE);
                    this.terminalLogger.logNormal(toolStrLimited);
                } else {
                    this.terminalLogger.logNormal(`[${this.sessionType}]: ${toolName}:`);
                    for (const [key, value] of Object.entries(record.args)) {
                        const commandStr = `    ${key}: ${value}`;
                        const commandStrLimited = this.limitString(commandStr, this.TOOL_MAX_LINE_SIZE);
                        this.terminalLogger.logNormal(commandStrLimited);
                    }
                }
            } else if (record.type === 'message_end') {
                const message = record.message;
                const content = message.content;
                const role = message.role;
                let thinking;
                let text;
                let toolName;
                if (role === 'system') {
                    // skip
                } else if (role === "toolResult") {
                    // skip
                } else if (role === "user") {
                    // skip
                } else {
                    if (Array.isArray(content) && content.length > 0) {
                        for (const block of content) {
                            if (block.type === 'thinking') {
                                thinking = block.thinking;
                            } else if (block.type === 'text') {
                                text = block.text;
                            } else if (block.type === 'toolCall') {
                                toolName = block.name;
                            }
                        }
                        if (text) {
                            this.terminalLogger.logNormal(`[${this.sessionType}]: \n${text}`);
                            this.messages.push(text);
                        }
                        if (toolName) {
                            // Logger.writeLine(`Tool: ${toolName}`);
                        }
                        if (!text && !toolName) {
                            if (thinking) {
                                this.terminalLogger.logDim(`[${this.sessionType}]: <thinking only>`);
                            } else {
                                this.terminalLogger.logNormal(`[${this.sessionType}]: ### NO CONTENT ###`);
                            }
                        }
                    } else if (message.errorMessage) {
                        this.terminalLogger.logError(`[${this.sessionType}]: ${message.errorMessage}`);
                    } else {
                        this.terminalLogger.logDim(`[${this.sessionType}]: ${JSON.stringify(record)}`);
                    }
                }
            } else if (record.type === 'agent_settled') {
                const aborted = record.aborted;
                if (aborted) {
                    this.terminalLogger.logError(`[${this.sessionType}]: session was aborted`);
                }
                if (!this.newSessionPending) {
                    this.onSettle(aborted);
                    if (!aborted) {
                        this.quit();
                    }
                }
            } else if (record.type === 'extension_ui_request' && record.method === 'notify') {
                this.terminalLogger.logError(`[${this.sessionType}]: ${record.message}`);
            }
        }
    }

    async steer(message) {
        const args = {
            id: `steer-${this.steerCount + 1}`,
            type: "steer",
            message: message
        };
        this.steerCount++;
        const disposition = (await this.rpcCall(args)).disposition;
        this.terminalLogger.logNormal(`Steer ${disposition}`);
    }

    async newSession() {
        const args = {
            type: "new_session",
            parentSession: this.sessionPath
        };
        this.newSessionPending = true;
        try {
            const cancelled = (await this.rpcCall(args)).cancelled;
            if (cancelled) {
                throw new Error("New session is cancelled");
            }
        } finally {
            this.newSessionPending = false;
        }
        this.steerCount = 0;
        this.messages.length = 0;
        this.settled = false;
        this.sessionPath = await this.getSessionPath();
    }

    onSettle(aborted) {
        this.settled = true;
    }

    onClose(code, signal) {
        this.tryTriggerExit(signal ? `killed by ${signal}` : code);
    }

    onError(err) {
        this.terminalLogger.logError(`Failed to start ${this.sessionType} Pi process. Is the "pi" CLI installed and in your PATH? Error: ${err.message}`);
        this.tryTriggerExit(null);
    }

    killProcess() {
        this.piProcess.kill();
    }

    quit() {
        this.terminalLogger.logDim(`Shutting down ${this.sessionType} process...`);
        this.piProcess.stdin.end();
    }

    tryTriggerExit(code) {
        if (!this.exited) {
            this.exited = true;
            this.eventEmitter.emit("exit", code);
        }
    }
}

