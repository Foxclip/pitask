import { spawn } from 'child_process';
import { Logger } from './logger.mjs';
import { FileLogger } from './filelogger.mjs';
import { EventEmitter, once } from 'events';

const emitter = new EventEmitter();

const TOOL_MAX_LINE_SIZE = 65;

// these record types are not fully logged because their data is
// already contained in other types
const lightRecords = [
    "message_start",
    "turn_end",
    "agent_end",
    "tool_execution_end",
];

// to avoid spamming log file on every streamed chunk
const skippedRecords = [
    "message_update"
];

const excludeTools = [
    "ask_user_question"
];

function limitString(str, max_size) {
    let result = str;
    if (str && max_size > 3 && str.length > max_size) {
        result = str.substring(0, max_size - 3);
        result += "...";
    }
    return result;
}

export class Worker {

    lineBuffer = '';
    piProcess;

    constructor() {

        // start the Pi process in RPC mode
        this.piProcess = spawn(
            'pi',
            [
                '--mode', 'rpc',
                '--exclude-tools', ...excludeTools,
            ],
            { stdio: ['pipe', 'pipe', 'inherit'] } // stdout is for protocol, stderr goes to console 
        );
        if (!this.piProcess.stdin || !this.piProcess.stdout) {
            throw new Error('Failed to initialize process streams.');
        }

        // event setup
        this.piProcess.stdout.on('data', (chunk) => this.onDataArrive(chunk));
        this.piProcess.on('close', (code) => {
            process.exit(code ?? 0);
        });
        this.piProcess.on('error', (err) => {
            console.error('Failed to start Pi process. Is the "pi" CLI installed and in your PATH?', err.message);
            process.exit(1);
        });
    }

    sendMessage(message) {
        this.piProcess.stdin.write(JSON.stringify(message) + '\n');
    }

    static getRecordsFromChunk(chunk) {
        let lineBuffer = chunk.toString('utf8');
        let lineEndIndex;
        let records = [];
        while((lineEndIndex = lineBuffer.indexOf('\n')) !== -1) {
            let line = lineBuffer.slice(0, lineEndIndex);
            lineBuffer = lineBuffer.slice(lineEndIndex + 1);
            // Strip optional preceding carriage return to handle CRLF safely
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }
            if (line === "") {
                continue;
            };

            let record;
            try {
                record = JSON.parse(line);
                records.push(record);
            } catch (err) {
                Logger.writeLine(`Failed to parse JSON record: ${line}`, Logger.COLOR_ERROR);
            }
        }
        return records;
    }

    async getSessionPath() {
        const analyzeChunk = (chunk) => { 
            const records = Worker.getRecordsFromChunk(chunk);
            for (const record of records) {
                if (record.type === "response" && record.command === "get_state") {
                    emitter.emit("done", record.data?.sessionFile);
                }
            }
        };
        this.piProcess.stdout.on("data", analyzeChunk);
        this.piProcess.stdin.write('{"type": "get_state"}\n');
        const result = await once(emitter, "done");
        this.piProcess.stdout.off("data", analyzeChunk);
        return result;
    }

    onDataArrive(chunk) {
        const records = Worker.getRecordsFromChunk(chunk);
        for (const record of records) {
            // some records are skipped, some only logged minimally
            // this is to avoid log file grow large
            if (!skippedRecords.includes(record.type)) {
                if (!lightRecords.includes(record.type)) {
                    FileLogger.writeLine(JSON.stringify(record));
                } else {
                    FileLogger.writeLine(`{"type": "${record.type}"}`);
                }
            }

            if (record.type === 'message_update') {
                const amEvent = record.assistantMessageEvent;
                if (amEvent && amEvent.type === 'thinking_start') {
                    Logger.writeLine("Worker thinking...", Logger.COLOR_DIM);
                } else if (amEvent && amEvent.type === 'text_start') {
                    Logger.writeLine("Worker writing message...", Logger.COLOR_DIM);
                }
            } else if (record.type === "tool_execution_start") {
                const toolName = record.toolName;
                if (Object.keys(record.args).length === 1) {
                    const argName = Object.keys(record.args)[0];
                    const argValue = record.args[argName];
                    const toolStr = `${toolName}: ${argName}: ${argValue}`;
                    const toolStrLimited = limitString(toolStr, TOOL_MAX_LINE_SIZE);
                    Logger.writeLine(toolStrLimited);
                } else {
                    Logger.writeLine(`${toolName}:`);
                    for (const [key, value] of Object.entries(record.args)) {
                        const commandStr = `    ${key}: ${value}`;
                        const commandStrLimited = limitString(commandStr, TOOL_MAX_LINE_SIZE);
                        Logger.writeLine(commandStrLimited);
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
                    Logger.writeLine(`[${role}]: <system prompt>`, Logger.COLOR_DIM);
                } else if (role === "toolResult") {
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
                            Logger.writeLine(`[${role}]: \n${text}`);
                        }
                        if (toolName) {
                            // Logger.writeLine(`Tool: ${toolName}`);
                        }
                        if (!text && !toolName) {
                            if (thinking) {
                                Logger.writeLine(`[${role}]: <thinking only>`, Logger.COLOR_DIM);
                            } else {
                                Logger.writeLine(`[${role}]: ### NO CONTENT ###`);
                            }
                        }
                    } else if (message.errorMessage) {
                        Logger.writeLine(`${message.errorMessage}`, Logger.COLOR_ERROR);
                    } else {
                        Logger.writeLine(JSON.stringify(record), Logger.COLOR_DIM);
                    }
                }
            } else if (record.type === 'agent_settled') {
                Logger.writeLine("Shutting down Worker process...");
                this.quit();
            }
        }
    }

    quit() {
        Logger.writeLine();
        this.piProcess.stdin.end();
    }
}

