import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, "server.js");

console.log("Starting server process for debugging...");
const serverProcess = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"], // Pipe all stdio
});

// Handle stderr (Logs and Device Code)
serverProcess.stderr.on("data", (data) => {
    console.error(`[SERVER LOG]: ${data.toString()}`);
});

// Handle stdout (JSON-RPC)
serverProcess.stdout.on("data", (data) => {
    const chunk = data.toString();
    const lines = chunk.split("\n");
    for (const line of lines) {
        if (!line.trim()) continue;
        console.log(`[SERVER JSON]: ${line}`);
    }
});

// Send initialization and then try to list notebooks to trigger auth
const requests = [
    {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "debug-client", version: "1.0.0" },
        },
    },
    {
        jsonrpc: "2.0",
        id: 2,
        method: "notifications/initialized",
    },
    {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
            name: "list_notebooks",
            arguments: {}
        }
    }
];

// Send requests sequentially with a slight delay to ensure processing
let i = 0;
function sendNext() {
    if (i >= requests.length) return;
    const req = requests[i++];
    console.log(`[CLIENT] Sending: ${req.method}`);
    serverProcess.stdin.write(JSON.stringify(req) + "\n");
    setTimeout(sendNext, 1000);
}

sendNext();

// Keep alive for a bit to allow auth flow
setTimeout(() => {
    console.log("Debug session ending...");
    serverProcess.kill();
}, 300000); // Wait 5 minutes for user to potentially read code if it works
