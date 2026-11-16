const { spawn } = require('child_process');

// 1. Start the Pi process in RPC mode
const piProcess = spawn('pi', ['--mode', 'rpc', '--no-session'], {
    stdio: ['pipe', 'pipe', 'inherit'] // stdout is for protocol, stderr goes to console
});

if (!piProcess.stdin || !piProcess.stdout) {
    throw new Error('Failed to initialize process streams.');
}

// 2. Send the initial command
const initial_command = {
    id: "prompt-1",
    type: "prompt",
    message: "Hello"
};

piProcess.stdin.write(JSON.stringify(initial_command) + '\n');

// 3. Custom buffer for strict JSONL framing
// We split ONLY on '\n' to avoid breaking JSON strings containing U+2028 or U+2029
let buffer = '';

piProcess.stdout.on('data', (chunk) => {
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

        // 4. Handle protocol records
        if (record.type === 'message_update') {
            const update = record.assistantMessageEvent;
            if (update && update.type === 'text_delta') {
                // Stream text deltas to stdout without a newline
                process.stdout.write(update.delta);
            }
        } else if (record.type === 'agent_settled') {
            // Print a final newline when the agent run finishes
            console.log();

            // Close stdin to request an orderly shutdown from the Pi process
            piProcess.stdin.end();
            break;
        }
    }
});

// 5. Handle process lifecycle
piProcess.on('close', (code) => {
    process.exit(code ?? 0);
});

piProcess.on('error', (err) => {
    console.error('Failed to start Pi process. Is the "pi" CLI installed and in your PATH?', err.message);
    process.exit(1);
});
