import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
// Helper function for making NWS API requests
async function makeProductPricingRequest() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const dataFilePath = path.resolve(__dirname, '../data/product-pricing.xlsx');
    const fileBuffer = await readExcelSheet(dataFilePath);
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
}
async function readExcelSheet(path) {
    try {
        const data = await readFile(path);
        return data;
    }
    catch (err) {
        console.error(err);
        throw err;
    }
}
makeProductPricingRequest();
// Register product pricing tools
server.tool("get-product-pricing", "Get product pricing for mirrors", {
    mirror: z.string().refine((val) => val.trim().split(/\s+/).length >= 2, { message: "Must contain at least two words" }),
}, async ({ mirror }) => {
    const products = await makeProductPricingRequest();
    const mirrorSearch = products.find(product => product.Mirror === mirror);
    console.log(mirrorSearch);
    return {
        content: [
            {
                type: "text",
                text: mirrorSearch ? `Price: $${mirrorSearch.Price}` : "Product not found.",
            },
        ],
    };
});
