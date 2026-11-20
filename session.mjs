import { spawn } from 'child_process';
import { TerminalLogger } from './terminal_logger.mjs';
import { FileLogger } from './file_logger.mjs';
import { EventEmitter, once } from 'events';
import { ChunkProcessor } from './chunk_processor.mjs';

export class Session {

    chunkProcessor;
    piProcess;
    sessionType;

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

    eventEmitter = new EventEmitter();

    TOOL_MAX_LINE_SIZE = 65;

    messages = [];

    fileLogger;

    limitString(str, max_size) {
        let result = str;
        if (str && max_size > 3 && str.length > max_size) {
            result = str.substring(0, max_size - 3);
            result += "...";
        }
        return result;
    }

    constructor(sessionType, fileLogger, excludeTools) {

        this.sessionType = sessionType;
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
        this.chunkProcessor = new ChunkProcessor();
        this.piProcess.stdout.on('data', (chunk) => this.onDataArrive(chunk));
        this.piProcess.on('close', (code) => { this.onClose(code); });
        this.piProcess.on('error', (err) => { this.onError(err); });
    }

    start() {  }

    async getSessionPath() {
        const analyzeChunk = (chunk) => { 
            const records = this.chunkProcessor.getRecords(chunk);
            for (const record of records) {
                if (record.type === "response" && record.command === "get_state") {
                    this.eventEmitter.emit("session", record.data?.sessionFile);
                }
            }
        };
        this.piProcess.stdout.on("data", analyzeChunk);
        this.piProcess.stdin.write('{"type": "get_state"}\n');
        const [result] = await once(this.eventEmitter, "session");
        this.piProcess.stdout.off("data", analyzeChunk);
        return result;
    }

    terminalLog(text, color) {
        TerminalLogger.writeLine(text, color);
    }

    fileLog(text) {
        this.fileLogger.writeLine(text);
    }

    onDataArrive(chunk) {
        const records = this.chunkProcessor.getRecords(chunk);
        for (const record of records) {
            // some records are skipped, some only logged minimally
            // this is to avoid log file grow large
            if (this.fileLogger) {
                if (!this.skippedRecords.includes(record.type)) {
                    if (!this.lightRecords.includes(record.type)) {
                        this.fileLog(JSON.stringify(record));
                    } else {
                        this.fileLog(`{"type": "${record.type}"}`);
                    }
                }
            }

            if (record.type === 'message_update') {
                const amEvent = record.assistantMessageEvent;
                if (amEvent && amEvent.type === 'thinking_start') {
                    this.terminalLog(`[${this.sessionType}]: thinking...`, TerminalLogger.COLOR_DIM);
                } else if (amEvent && amEvent.type === 'text_start') {
                    this.terminalLog(`[${this.sessionType}]: writing message...`, TerminalLogger.COLOR_DIM);
                }
            } else if (record.type === "tool_execution_start") {
                const toolName = record.toolName;
                if (Object.keys(record.args).length === 1) {
                    const argName = Object.keys(record.args)[0];
                    const argValue = record.args[argName];
                    const toolStr = `[${this.sessionType}]: ${toolName}: ${argName}: ${argValue}`;
                    const toolStrLimited = this.limitString(toolStr, this.TOOL_MAX_LINE_SIZE);
                    this.terminalLog(toolStrLimited);
                } else {
                    this.terminalLog(`[${this.sessionType}]: ${toolName}:`);
                    for (const [key, value] of Object.entries(record.args)) {
                        const commandStr = `    ${key}: ${value}`;
                        const commandStrLimited = this.limitString(commandStr, this.TOOL_MAX_LINE_SIZE);
                        this.terminalLog(commandStrLimited);
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
                            this.terminalLog(`[${this.sessionType}]: \n${text}`);
                            this.messages.push(text);
                        }
                        if (toolName) {
                            // Logger.writeLine(`Tool: ${toolName}`);
                        }
                        if (!text && !toolName) {
                            if (thinking) {
                                this.terminalLog(`[${this.sessionType}]: <thinking only>`, TerminalLogger.COLOR_DIM);
                            } else {
                                this.terminalLog(`[${this.sessionType}]: ### NO CONTENT ###`);
                            }
                        }
                    } else if (message.errorMessage) {
                        this.terminalLog(`[${this.sessionType}]: ${message.errorMessage}`, TerminalLogger.COLOR_ERROR);
                    } else {
                        this.terminalLog(`[${this.sessionType}]: ${JSON.stringify(record)}`, TerminalLogger.COLOR_DIM);
                    }
                }
            } else if (record.type === 'agent_settled') {
                this.onSettle();
                this.quit();
            }
        }
    }

    onSettle() {  }

    onClose() {  }

    onError(err) {
        this.terminalLog(`Failed to start ${this.sessionType} Pi process. Is the "pi" CLI installed and in your PATH? Error: ${err.message}`, TerminalLogger.COLOR_ERROR);
    }

    killProcess() {
        this.piProcess.kill();
    }

    quit() {
        this.terminalLog(`Shutting down ${this.sessionType} process...`, TerminalLogger.COLOR_DIM);
        this.piProcess.stdin.end();
    }
}

