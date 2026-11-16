import { spawn } from 'child_process';
import { Logger } from './logger.mjs';
import { appendFileSync } from 'fs';

export class Worker {

    lineBuffer = '';
    piProcess;

    constructor() {

        // start the Pi process in RPC mode
        this.piProcess = spawn(
            'pi',
            ['--mode', 'rpc', '--no-session'],
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

    onDataArrive(chunk) {
        this.lineBuffer += chunk.toString('utf8');
        let lineEndIndex;

        while ((lineEndIndex = this.lineBuffer.indexOf('\n')) !== -1) {
            let line = this.lineBuffer.slice(0, lineEndIndex);
            this.lineBuffer = this.lineBuffer.slice(lineEndIndex + 1);

            // Strip optional preceding carriage return to handle CRLF safely
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }

            if (line === '') continue;

            let record;
            try {
                record = JSON.parse(line);
            } catch (err) {
                Logger.writeLine(`Failed to parse JSON record: ${line}`, Logger.COLOR_ERROR);
                continue;
            }

            // Logger.writeLine(`Record type: ${record.type}`);

            if (record.type !== 'message_update') {
                appendFileSync("run.log", `${line}\n`, "utf8");
            }

            if (record.type === 'message_update') {
                const amEvent = record.assistantMessageEvent;
                if (amEvent && amEvent.type === 'thinking_start') {
                    Logger.writeLine("Worker thinking...", Logger.COLOR_DIM);
                } else if (amEvent && amEvent.type === 'text_start') {
                    Logger.writeLine("Worker writing message...", Logger.COLOR_DIM);
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
                            Logger.writeLine(`[${role}]: ${text}`);
                        } else {
                            Logger.writeLine(`[${role}]: ### NO TEXT ###`);
                        }
                        if (toolName) {
                            Logger.writeLine(`### Tool: ${toolName} ###`);
                        }
                    } else if (message.errorMessage) {
                        Logger.writeLine(`${message.errorMessage}`, Logger.COLOR_ERROR);
                    } else {
                        Logger.writeLine(line, Logger.COLOR_DIM);
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

