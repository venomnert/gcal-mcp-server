import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";
import { readFile } from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from "xlsx";

// Create server instance
const server = new McpServer({
  name: "weather",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Helper function for making NWS API requests
async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

interface AlertFeature {
  properties: {
    event?: string;
    areaDesc?: string;
    severity?: string;
    status?: string;
    headline?: string;
  };
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties;
  return [
    `Event: ${props.event || "Unknown"}`,
    `Area: ${props.areaDesc || "Unknown"}`,
    `Severity: ${props.severity || "Unknown"}`,
    `Status: ${props.status || "Unknown"}`,
    `Headline: ${props.headline || "No headline"}`,
    "---",
  ].join("\n");
}

interface ForecastPeriod {
  name?: string;
  temperature?: number;
  temperatureUnit?: string;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

interface AlertsResponse {
  features: AlertFeature[];
}

interface PointsResponse {
  properties: {
    forecast?: string;
  };
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[];
  };
}

// Register weather tools
server.tool(
  "get-alerts",
  "Get weather alerts for a state",
  {
    state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
  },
  async ({ state }) => {
    const stateCode = state.toUpperCase();
    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl);

    if (!alertsData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve alerts data",
          },
        ],
      };
    }

    const features = alertsData.features || [];
    if (features.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No active alerts for ${stateCode}`,
          },
        ],
      };
    }

    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: alertsText,
        },
      ],
    };
  },
);

server.tool(
  "get-forecast",
  "Get weather forecast for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z.number().min(-180).max(180).describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    // Get grid point data
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`,
          },
        ],
      };
    }

    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to get forecast URL from grid point data",
          },
        ],
      };
    }

    // Get forecast data
    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve forecast data",
          },
        ],
      };
    }

    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No forecast periods available",
          },
        ],
      };
    }

    // Format forecast periods
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
      ].join("\n"),
    );

    const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;

    return {
      content: [
        {
          type: "text",
          text: forecastText,
        },
      ],
    };
  },
);


/*
*/
// Define a type for your product rows
interface Product {
  Product: string;
  Price: number;
  // Add other fields if present in your sheet
}

async function makeProductPricingRequest(): Promise<Product[]> {
  const fileBuffer = await readExcelSheet('../data/product-pricing.xlsx');
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Product>(worksheet);
  return data;
}

async function makeVendorPricingRequest(): Promise<Product[]> {
  const fileBuffer = await readExcelSheet('../data/product-pricing.xlsx');
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Product>(worksheet);
  return data;
}

async function readExcelSheet(file_path: string): Promise<Buffer> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);  
  const dataFilePath = path.resolve(__dirname, file_path);
  try{
    const data = await readFile(dataFilePath);
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
        product.Product.toLowerCase().includes(mirror.toLowerCase())
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


/*
  Execute Server
*/
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio");

  const mirror = "goldFullMirror"
  const products = await makeProductPricingRequest();
  console.error("Products loaded:", products.length);
  const mirrorSearch = products.find(product => 
    product.Product.toLowerCase().includes(mirror.toLowerCase())
  );
  console.error("Mirror search result:", mirrorSearch);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});