import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from "xlsx";
import { main as calendarMain, listEventsForDay } from "./calendar.js";
// Create server instance
const server = new McpServer({
    name: "weather",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
async function readExcelSheet(file_path) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const dataFilePath = path.resolve(__dirname, file_path);
    try {
        const data = await readFile(dataFilePath);
        return data;
    }
    catch (err) {
        console.error(err);
        throw err;
    }
}
async function makeProductPricingRequest() {
    const fileBuffer = await readExcelSheet('../data/product-pricing.xlsx');
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
}
async function makeVenuePricingRequest() {
    const fileBuffer = await readExcelSheet('../data/venue-pricing.xlsx');
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
}
async function makeAddonPricingRequest(sheetName) {
    const fileBuffer = await readExcelSheet('../data/addon-pricing.xlsx');
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
}
// Register product pricing tools
server.tool("get-product-pricing", "Get product pricing for mirrors", {
    mirror: z.string()
        .min(1, { message: "Mirror name cannot be empty" })
        .refine(val => val.split(/(?=[A-Z])/).length === 3, { message: "Mirror must be exactly three words long (camelCase)" })
        .refine(val => /^[a-z]+([A-Z][a-z]*){2}$/.test(val), { message: "Mirror must be camelCase and three words long" }),
}, async ({ mirror }) => {
    console.error("Handler started with mirror:", mirror);
    try {
        const products = await makeProductPricingRequest();
        console.error("Products loaded:", products.length);
        const mirrorSearch = products.find(product => product.Product.toLowerCase().includes(mirror.toLowerCase()));
        console.error("Mirror search result:", mirrorSearch);
        return {
            content: [
                {
                    type: "text",
                    text: mirrorSearch ? `Price: $${mirrorSearch.Price}` : "Product not found.",
                },
            ],
        };
    }
    catch (error) {
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
});
server.tool("get-venue-pricing", "Get venue pricing for mirrors", {
    venue: z.string()
        .min(1, { message: "Venue name cannot be empty" }),
}, async ({ venue }) => {
    console.error("Handler started with venue:", venue);
    try {
        const venues = await makeVenuePricingRequest();
        console.error("Venues:", venues);
        const venueSearch = venues.find(v => v.Venue.toLowerCase().includes(venue.toLowerCase()));
        console.error("Venue search result:", venueSearch);
        return {
            content: [
                {
                    type: "text",
                    text: venueSearch ? `Price: $${venueSearch.Price}` : "Venue not found.",
                },
            ],
        };
    }
    catch (error) {
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
});
server.tool("get-addon-pricing", "Get add-on pricing for mirrors", {
    addOn: z.string()
        .min(1, { message: "Add-on name cannot be empty" }),
    sheet: z.enum(["Half Mirror", "Full Mirror"], {
        errorMap: () => ({ message: "Add-on must be one of the allowed options" })
    }),
}, async ({ addOn, sheet }) => {
    console.error("Handler started with add-on:", addOn);
    try {
        const addOns = await makeAddonPricingRequest(sheet);
        console.error("Add-ons:", addOns);
        const addOnSearch = addOns.find(a => a.AddOn.toLowerCase().includes(addOn.toLowerCase()));
        console.error("Add-on search result:", addOnSearch);
        return {
            content: [
                {
                    type: "text",
                    text: addOnSearch ? `Price: $${addOnSearch.Price}` : "Add-on not found.",
                },
            ],
        };
    }
    catch (error) {
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
});
server.tool("get-calendar-events", "Get calendar events", {
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Date must be in yyyy-mm-dd format" }),
}, async ({ eventDate }) => {
    try {
        const authClient = await calendarMain();
        const specificDay = new Date(eventDate);
        console.log(`\nFetching calendar events for ${specificDay.toDateString()}...`);
        const events = await listEventsForDay(authClient, specificDay);
        console.error(events);
        return {
            content: [
                {
                    type: "text",
                    text: events ? `Events: ${events}` : "No events found.",
                },
            ],
        };
    }
    catch (error) {
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
});
/*
  Execute Server
*/
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Server started");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
