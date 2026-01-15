import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ErrorCode,
    McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { PublicClientApplication, LogLevel } from "@azure/msal-node";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

// Configuration
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
// NOTE: For Device Code Flow with PublicClientApplication, Client Secret is generally NOT used.
// We will use PublicClientApplication.
const AUTHORITY = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}`;
// const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET; // Not needed for PublicClientApplication
const TOKEN_CACHE_PATH = process.env.TOKEN_CACHE_PATH || path.join(__dirname, "token_cache.json");
const GRAPH_ENDPOINT = "https://graph.microsoft.com/v1.0";

const SCOPES = ["User.Read", "Notes.Read", "Notes.Create", "Notes.ReadWrite"];

// Token Cache Plugin
const cachePlugin = {
    beforeCacheAccess: async (context) => {
        if (fs.existsSync(TOKEN_CACHE_PATH)) {
            context.tokenCache.deserialize(fs.readFileSync(TOKEN_CACHE_PATH, "utf-8"));
        }
    },
    afterCacheAccess: async (context) => {
        if (context.cacheHasChanged) {
            fs.writeFileSync(TOKEN_CACHE_PATH, context.tokenCache.serialize());
        }
    },
};

// MSAL Configuration
const msalConfig = {
    auth: {
        clientId: CLIENT_ID,
        authority: AUTHORITY,
    },
    cache: {
        cachePlugin,
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message, containsPii) {
                // Log to stderr to avoid interfering with MCP stdout
                if (loglevel === LogLevel.Error) {
                    console.error(message);
                }
            },
            piiLoggingEnabled: false,
            logLevel: LogLevel.Warning,
        },
    },
};

const pca = new PublicClientApplication(msalConfig);


async function getAccessToken() {
    // Try to acquire token silently
    const accounts = await pca.getTokenCache().getAllAccounts();

    if (accounts.length > 0) {
        try {
            const response = await pca.acquireTokenSilent({
                account: accounts[0],
                scopes: SCOPES,
            });
            return response.accessToken;
        } catch (error) {
            console.error("Silent token acquisition failed, falling back to device code.", error);
        }
    }

    // Fallback to Device Code Flow
    const deviceCodeRequest = {
        deviceCodeCallback: (response) => {
            // Use console.error to print to stderr so users see it but it doesn't break MCP protocol
            console.error("Device Code Response:", JSON.stringify(response, null, 2));
            if (response.message) {
                console.error(response.message);
            }
        },
        scopes: SCOPES,
    };

    try {
        const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
        return response.accessToken;
    } catch (error) {
        console.error("Device code flow failed:", JSON.stringify(error, null, 2));
        throw error;
    }
}

async function graphRequest(endpoint, method = "GET", body = null) {
    const token = await getAccessToken();
    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };

    const options = {
        method,
        headers,
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    let response = await fetch(`${GRAPH_ENDPOINT}${endpoint}`, options);

    // Handle Rate Limiting (Throttling) - Basic implementation
    if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After") || 1;
        console.error(`Throttled. Retrying after ${retryAfter} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        response = await fetch(`${GRAPH_ENDPOINT}${endpoint}`, options);
    }

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Graph API Error: ${response.status} ${response.statusText}`;
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error && errorJson.error.message) {
                errorMessage += ` - ${errorJson.error.message}`;
            }
        } catch (e) {
            errorMessage += ` - ${errorText}`;
        }
        throw new Error(errorMessage);
    }

    // Some Create calls return 204 No Content or just the created object
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        return await response.json();
    } else {
        return await response.text();
    }
}

// MCP Server Setup
const server = new Server(
    {
        name: "mcp-onenote",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "list_notebooks",
                description: "List all OneNote notebooks",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "list_sections",
                description: "List sections in a notebook",
                inputSchema: {
                    type: "object",
                    properties: {
                        notebookId: {
                            type: "string",
                            description: "The ID of the notebook"
                        }
                    },
                    required: ["notebookId"],
                },
            },
            {
                name: "list_pages",
                description: "List pages in a section",
                inputSchema: {
                    type: "object",
                    properties: {
                        sectionId: {
                            type: "string",
                            description: "The ID of the section"
                        }
                    },
                    required: ["sectionId"],
                },
            },
            {
                name: "read_content",
                description: "Read the HTML content of a page",
                inputSchema: {
                    type: "object",
                    properties: {
                        pageId: {
                            type: "string",
                            description: "The ID of the page"
                        }
                    },
                    required: ["pageId"],
                },
            },
            {
                name: "create_notebook",
                description: "Create a new OneNote notebook",
                inputSchema: {
                    type: "object",
                    properties: {
                        displayName: {
                            type: "string",
                            description: "Name of the new notebook"
                        }
                    },
                    required: ["displayName"]
                }
            },
            {
                name: "create_section",
                description: "Create a new section in a notebook",
                inputSchema: {
                    type: "object",
                    properties: {
                        notebookId: {
                            type: "string",
                            description: "ID of the notebook"
                        },
                        displayName: {
                            type: "string",
                            description: "Name of the new section"
                        }
                    },
                    required: ["notebookId", "displayName"]
                }
            },
            {
                name: "create_page",
                description: "Create a new page in a section",
                inputSchema: {
                    type: "object",
                    properties: {
                        sectionId: {
                            type: "string",
                            description: "ID of the section"
                        },
                        htmlContent: {
                            type: "string",
                            description: "HTML content of the page"
                        }
                    },
                    required: ["sectionId", "htmlContent"]
                }
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        switch (request.params.name) {
            case "list_notebooks": {
                const result = await graphRequest("/me/onenote/notebooks");
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result.value, null, 2),
                        },
                    ],
                };
            }
            case "list_sections": {
                const { notebookId } = request.params.arguments;
                const result = await graphRequest(`/me/onenote/notebooks/${notebookId}/sections`);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result.value, null, 2),
                        },
                    ],
                };
            }
            case "list_pages": {
                const { sectionId } = request.params.arguments;
                const result = await graphRequest(`/me/onenote/sections/${sectionId}/pages`);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result.value, null, 2),
                        },
                    ],
                };
            }
            case "read_content": {
                const { pageId } = request.params.arguments;
                const result = await graphRequest(`/me/onenote/pages/${pageId}/content`);
                // result is likely HTML text
                return {
                    content: [
                        {
                            type: "text",
                            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
            case "create_notebook": {
                const { displayName } = request.params.arguments;
                const result = await graphRequest("/me/onenote/notebooks", "POST", { displayName });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }
                    ]
                }
            }
            case "create_section": {
                const { notebookId, displayName } = request.params.arguments;
                const result = await graphRequest(`/me/onenote/notebooks/${notebookId}/sections`, "POST", { displayName });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }
                    ]
                }
            }
            case "create_page": {
                const { sectionId, htmlContent } = request.params.arguments;
                // Page creation requires specific multipart or just body.
                // Simple HTML page creation:
                // https://graph.microsoft.com/v1.0/me/onenote/sections/{id}/pages
                // Content-Type: text/html triggers simple creation if no multipart needed.
                // However, node-fetch with body string defaults to text/plain if not set, but we set application/json in graphRequest helper.
                // For create_page, we might need text/html or multipart.
                // Let's adjust graphRequest or handle it here.

                const token = await getAccessToken();
                const response = await fetch(`${GRAPH_ENDPOINT}/me/onenote/sections/${sectionId}/pages`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "text/html"
                    },
                    body: `<!DOCTYPE html><html><head><title>New Page</title></head><body>${htmlContent}</body></html>`
                });

                if (!response.ok) throw new Error(`Failed to create page: ${response.statusText}`);
                const result = await response.json();

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }
                    ]
                }
            }

            default:
                throw new McpError(
                    ErrorCode.MethodNotFound,
                    `Unknown tool: ${request.params.name}`
                );
        }
    } catch (error) {
        console.error("Error executing tool:", error);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        error: error.message,
                    }),
                },
            ],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
