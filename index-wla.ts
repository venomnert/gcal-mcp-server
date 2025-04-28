import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from "zod";
import XLSX from "xlsx";

// Create server instance
const server = new McpServer({
  name: "product-information",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Define a type for your product rows
interface Product {
  Mirror: string;
  Price: number;
  // Add other fields if present in your sheet
}

// Helper function for making NWS API requests
async function makeProductPricingRequest(): Promise<Product[]> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);  
  const dataFilePath = path.resolve(__dirname, '../data/product-pricing.xlsx');
  const fileBuffer = await readExcelSheet(dataFilePath);
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Product>(worksheet);
  return data;
}

async function readExcelSheet(path: string): Promise<Buffer> {
  try {
    const data = await readFile(path);
    return data as Buffer;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

// Register product pricing tools
server.tool(
    "get-product-pricing",
    "Get product pricing for mirrors",
    {
      mirror: z.string()
        .min(1, { message: "Mirror name cannot be empty" })
        .refine(
          val => val.split(/(?=[A-Z])/).length === 3,
          { message: "Mirror must be exactly three words long (camelCase)" }
        )
        .refine(
          val => /^[a-z]+([A-Z][a-z]*){2}$/.test(val),
          { message: "Mirror must be camelCase and three words long" }
        ),
    },
    async ({ mirror }) => {
      console.error("Handler started with mirror:", mirror);
      try {
        const products = await makeProductPricingRequest();
        console.error("Products loaded:", products.length);
        const mirrorSearch = products.find(product => 
          product.Mirror.toLowerCase().includes(mirror.toLowerCase())
        );
        console.error("Mirror search result:", mirrorSearch);
        return {
          content: [
            {
              type: "text",
              text: mirrorSearch ? `Price: $${mirrorSearch.Price}` : "Product not found.",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to execute tool:", error);
        return {
          content: [
            {
              type: "text",
              text: "An error occurred while executing the tool.",
            },
          ],
        };
      }
    },
);

// Initialize the server with a transport
console.error("Initializing server...");
const transport = new StdioServerTransport();

// Connect to the transport asynchronously
(async () => {
  try {
    await server.connect(transport);
    console.error("Server started and connected successfully");
    
    // Log incoming messages for debugging
    transport.onmessage = (message) => {
      console.error("Message from client:", JSON.stringify(message));
    };
    
    // Handle transport errors
    transport.onerror = (error) => {
      console.error("Transport error:", error);
    };
    
    // Handle transport close
    transport.onclose = () => {
      console.error("Server transport closed");
    };
    
  } catch (error) {
    console.error("Failed to connect server:", error);
  }
})();
