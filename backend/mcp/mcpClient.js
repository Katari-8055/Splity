import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SpendSavvyMcpClient {
  constructor() {
    this.client = null;
    this.transport = null;
    this.isConnected = false;
    this.connectingPromise = null;
    this.toolsCache = null;
  }

  async connect() {
    if (this.isConnected && this.client) {
      return this.client;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      try {
        const mcpServerPath = path.resolve(__dirname, "../../mcp/server.js");
        
        this.transport = new StdioClientTransport({
          command: process.execPath, // Node.js executable
          args: [mcpServerPath],
          env: { ...process.env }
        });

        this.client = new Client(
          {
            name: "spendsavvy-backend-client",
            version: "1.0.0",
          },
          {
            capabilities: {},
          }
        );

        await this.client.connect(this.transport);
        this.isConnected = true;
        console.log("[MCP Client] Connected successfully to SpendSavvy MCP Server on Stdio transport");

        // Handle transport unexpected termination
        this.transport.onclose = () => {
          console.warn("[MCP Client] Transport closed. Resetting connection state for auto-reconnect.");
          this.isConnected = false;
          this.client = null;
        };

        // Cache initial tool list
        const toolsResult = await this.client.listTools();
        this.toolsCache = toolsResult.tools || [];
        console.log(`[MCP Client] Discovered ${this.toolsCache.length} MCP tools:`, this.toolsCache.map(t => t.name).join(", "));

        return this.client;
      } catch (err) {
        console.error("[MCP Client] Failed to connect to MCP Server:", err.message);
        this.isConnected = false;
        this.client = null;
        throw err;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  async listTools() {
    await this.connect();
    const result = await this.client.listTools();
    this.toolsCache = result.tools || [];
    return this.toolsCache;
  }

  /**
   * Execute an MCP tool securely injecting authenticated userId
   */
  async callTool(toolName, args = {}, authenticatedUserId) {
    await this.connect();

    // Security context binding: ensure caller cannot impersonate another user
    const safeArgs = { ...args };
    if (authenticatedUserId) {
      // Overwrite user identification parameters with trusted auth context unconditionally
      safeArgs.userId = authenticatedUserId;
      if ('createdBy' in safeArgs || toolName === 'create_group') {
        safeArgs.createdBy = authenticatedUserId;
      }
    }

    const startTime = Date.now();
    try {
      const response = await this.client.callTool({
        name: toolName,
        arguments: safeArgs,
      });

      const latency = Date.now() - startTime;
      console.log(`[MCP Tool Call] ${toolName} completed in ${latency}ms`);

      let parsedData = null;
      if (response.content && response.content[0] && response.content[0].text) {
        try {
          parsedData = JSON.parse(response.content[0].text);
        } catch {
          parsedData = response.content[0].text;
        }
      }

      return {
        success: true,
        data: parsedData,
        raw: response,
        latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      console.error(`[MCP Tool Call Error] ${toolName} failed in ${latency}ms:`, error.message);
      return {
        success: false,
        error: error.message || String(error),
        latency,
      };
    }
  }

  /**
   * Convert JSON Schema object to dynamic Zod Schema for LangChain
   */
  jsonSchemaToZod(jsonSchema) {
    if (!jsonSchema || !jsonSchema.properties) {
      return z.object({});
    }

    const shape = {};
    for (const [propName, propDef] of Object.entries(jsonSchema.properties)) {
      let schema;
      switch (propDef.type) {
        case "string":
          schema = z.string();
          break;
        case "number":
          schema = z.number();
          break;
        case "integer":
          schema = z.number().int();
          break;
        case "boolean":
          schema = z.boolean();
          break;
        case "array":
          if (propDef.items && propDef.items.type === "number") {
            schema = z.array(z.number());
          } else {
            schema = z.array(z.string());
          }
          break;
        default:
          schema = z.string();
          break;
      }

      if (propDef.description) {
        schema = schema.describe(propDef.description);
      }

      const isRequired = jsonSchema.required && jsonSchema.required.includes(propName);
      if (!isRequired) {
        schema = schema.optional();
      }

      shape[propName] = schema;
    }

    return z.object(shape);
  }

  /**
   * Generate LangChain DynamicStructuredTools dynamically from MCP Tools
   */
  async getLangChainTools(authenticatedUserId) {
    const mcpTools = await this.listTools();
    
    // Tools safe for normal user expense assistant (exclude raw admin tools)
    const allowedTools = [
      "list_expenses",
      "get_monthly_summary",
      "get_weekly_summary",
      "get_spending_by_category",
      "get_category_spending",
      "get_friend_contributions",
      "list_friends",
      "search_friends",
      "list_groups",
      "get_group_details",
      "get_user_balances",
      "settle_up",
      "create_expense_with_split",
      "create_group",
      "add_friend",
      "list_notifications",
      "acknowledge_notification",
      "get_receipts"
    ];

    return mcpTools
      .filter((tool) => allowedTools.includes(tool.name))
      .map((tool) => {
        const zodSchema = this.jsonSchemaToZod(tool.inputSchema);
        
        return new DynamicStructuredTool({
          name: tool.name,
          description: tool.description,
          schema: zodSchema,
          func: async (inputArgs) => {
            const result = await this.callTool(tool.name, inputArgs, authenticatedUserId);
            if (!result.success) {
              return JSON.stringify({ error: result.error });
            }
            return typeof result.data === "object" ? JSON.stringify(result.data) : String(result.data);
          },
        });
      });
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.isConnected = false;
    }
  }
}

export const mcpClient = new SpendSavvyMcpClient();
