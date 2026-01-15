# OneNote MCP Server

A Model Context Protocol (MCP) server for Microsoft OneNote, allowing AI agents like Claude or Cline to read and create notebooks, sections, and pages.

## Features

- **Read**: List notebooks, sections, pages, and read page content.
- **Create**: Create notebooks, sections, and pages.
- **Authentication**: Azure AD Device Code Flow (supports easy login for desktop apps).

## Prerequisites

- Node.js 16+
- A Microsoft Account (Personal or Work/School)

## Setup

### 1. Azure App Registration (One-time setup)

To access OneNote, you need your own App ID from Microsoft Azure. It's free and takes 2 minutes.

1.  Go to the [Azure Portal - App Registrations](https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps).
2.  Click **"New registration"**.
3.  Fill in the form:
    *   **Name**: `MCP OneNote` (or any name you like).
    *   **Supported account types**: Select the 3rd option: *"Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"*.
    *   **Redirect URI**: Select **Public client/native (mobile & desktop)** and enter `http://localhost`.
    *   Click **Register**.
4.  **Important**: Enable Public Client Flows.
    *   In your new app menu, go to **Authentication** (left sidebar).
    *   Scroll down to **Advanced settings**.
    *   Set **Allow public client flows** to **Yes**.
    *   Click **Save**.
5.  **Copy your Client ID**:
    *   Go to **Overview** (left sidebar).
    *   Copy the **Application (client) ID**. You'll need it for step 2.

### 2. Installation & Configuration

1.  Clone this repository and install dependencies:
    ```bash
    npm install
    ```

2.  Configure credentials:
    ```bash
    cp .env.example .env
    ```
    Edit `.env` and paste your Client ID:
    ```env
    MICROSOFT_CLIENT_ID=your-copied-client-id
    MICROSOFT_TENANT_ID=common
    ```

3.  **First-time Authentication**:
    The server needs to create a token cache. Run this debug script once to log in:
    ```bash
    node debug_auth.js
    ```
    *   Follow the instructions (open link, enter code).
    *   Once confirmed, a `token_cache.json` file will be created.

## Integration

### Option A: Claude Desktop

Add this to your `claude_desktop_config.json` (typically in `AppData/Roaming/Claude/` on Windows or `~/Library/Application Support/Claude/` on Mac):

```json
{
  "mcpServers": {
    "onenote": {
      "command": "node",
      "args": ["C:/absolute/path/to/mcp-onenote/server.js"]
    }
  }
}
```

### Option B: VS Code (via Cline)

1.  Install the **Cline** extension in VS Code.
2.  Open Cline settings -> **MCP Servers**.
3.  Add the same configuration as above:
    ```json
    {
      "mcpServers": {
        "onenote": {
          "command": "node",
          "args": ["C:/absolute/path/to/mcp-onenote/server.js"]
        }
      }
    }
    ```

## Tools

- `create_notebook`: { displayName }
- `create_section`: { notebookId, displayName }
- `create_page`: { sectionId, htmlContent }
- `list_notebooks`
- `list_sections`: { notebookId }
- `list_pages`: { sectionId }
- `read_content`: { pageId }
