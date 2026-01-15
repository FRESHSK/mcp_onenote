import { spawn } from "child_process";
import path from "path";

const serverPath = path.resolve("server.js");

console.log("Starting server process...");
const serverProcess = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "inherit"], // inherit stderr to see logs
});

let buffer = "";

serverProcess.stdout.on("data", (data) => {
    const chunk = data.toString();
    buffer += chunk;

    // Try to parse JSON lines
    const lines = buffer.split("\n");
    buffer = lines.pop(); // Keep incomplete line

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const message = JSON.parse(line);
            console.log("Received message:", message);

            if (message.result && message.result.capabilities) {
                console.log("✅ Initialization successful!");

                // Send list_tools request
                const listToolsRequest = {
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/list",
                };
                serverProcess.stdin.write(JSON.stringify(listToolsRequest) + "\n");
            } else if (message.result && message.result.tools) {
                console.log(`✅ Tools listed: ${message.result.tools.length} found.`);
                console.log("Test passed. Exiting.");
                process.exit(0);
            }
        } catch (e) {
            // console.error("Failed to parse JSON:", e);
        }
    }
});

// Send initialize request
const initRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
            name: "test-client",
            version: "1.0.0",
        },
    },
};

console.log("Sending initialize request...");
serverProcess.stdin.write(JSON.stringify(initRequest) + "\n");

// Timeout
setTimeout(() => {
    console.error("Test timed out.");
    serverProcess.kill();
    process.exit(1);
}, 5000);
