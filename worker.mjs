import { spawn } from 'child_process';

export class Worker {

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
        this.piProcess.stdout.on('data', this.onDataArrive);
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
        let buffer = '';
        buffer += chunk.toString('utf8');
        let lineEndIndex;

        while ((lineEndIndex = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, lineEndIndex);
            buffer = buffer.slice(lineEndIndex + 1);

            // Strip optional preceding carriage return to handle CRLF safely
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }

            if (line === '') continue;

            let record;
            try {
                record = JSON.parse(line);
            } catch (err) {
                console.error('Failed to parse JSON record:', line);
                continue;
            }

            if (record.type === 'message_update') {
                const update = record.assistantMessageEvent;
                if (update && update.type === 'text_delta') {
                    process.stdout.write(update.delta);
                }
            } else if (record.type === 'agent_settled') {
                console.log("Exiting process...");
                this.quit();
            }
        }
    }

    quit() {
        console.log();
        this.piProcess.stdin.end();
    }
}

