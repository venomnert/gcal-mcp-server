import { google } from 'googleapis';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as url from 'url';
import open from 'open';
import * as dotenv from 'dotenv'; // Import dotenv
// --- Load Environment Variables ---
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });
// --- Configuration ---
// Read credentials from environment variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// You could also load this from .env, providing a default
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
// Validate that required environment variables are set
if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Error: Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env file.");
    console.error("Please ensure you have a .env file in the project root with these values.");
    process.exit(1); // Exit if credentials are not found
}
// Scope for read-only access to Calendar API
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
// Path to store the token file (using .credentials in home directory)
const TOKEN_PATH = path.join(os.homedir(), '.credentials', 'calendar-nodejs-token.json');
// --- End Configuration ---
/**
 * Creates an OAuth2 client with the given credentials.
 * Now reads CLIENT_ID and CLIENT_SECRET from the validated constants.
 */
function createOAuthClient() {
    // We already validated CLIENT_ID and CLIENT_SECRET are strings above
    return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}
/**
 * Reads previously authorized credentials from the save file.
 * @param client The OAuth2 client.
 */
async function loadSavedCredentialsIfExist(client) {
    try {
        const content = await fs.readFile(TOKEN_PATH, 'utf8');
        const credentials = JSON.parse(content);
        // Important: Set credentials on the client *instance*
        // The client instance already knows the CLIENT_ID/SECRET from createOAuthClient
        client.setCredentials(credentials);
        // Check if the token is expired or needs refresh
        if (client.credentials.expiry_date &&
            client.credentials.expiry_date <= Date.now()) {
            console.log('Token is expiring, attempting refresh...');
            try {
                const { credentials: newCredentials } = await client.refreshAccessToken();
                client.setCredentials(newCredentials);
                await saveCredentials(client); // Save the refreshed token
                console.log('Token refreshed successfully.');
            }
            catch (refreshError) {
                console.error('Error refreshing access token, will re-authenticate:', refreshError);
                return null; // Need to re-authenticate
            }
        }
        return client;
    }
    catch (err) {
        // If file doesn't exist or other error, return null
        return null;
    }
}
/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 * @param client The OAuth2 client to save credentials from.
 */
async function saveCredentials(client) {
    if (!client.credentials) {
        throw new Error('Client has no credentials to save.');
    }
    // We use the CLIENT_ID and CLIENT_SECRET from the environment variables
    // that the client was initialized with.
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: CLIENT_ID, // Use the value read from .env
        client_secret: CLIENT_SECRET, // Use the value read from .env
        refresh_token: client.credentials.refresh_token,
        // Include access token and expiry for immediate use, though refresh_token is key
        access_token: client.credentials.access_token,
        expiry_date: client.credentials.expiry_date,
    });
    try {
        // Ensure the directory exists
        await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });
        await fs.writeFile(TOKEN_PATH, payload);
        console.log(`Token stored to ${TOKEN_PATH}`);
    }
    catch (err) {
        console.error(`Error saving token to ${TOKEN_PATH}:`, err);
        throw err; // Re-throw error after logging
    }
}
/**
 * Handles the OAuth2 flow, prompting the user for authorization if needed.
 */
async function authorize() {
    const client = createOAuthClient(); // Client now created with env vars
    let authenticatedClient = await loadSavedCredentialsIfExist(client);
    if (authenticatedClient) {
        return authenticatedClient;
    }
    // No valid token found, start the authorization flow
    return new Promise((resolve, reject) => {
        const authUrl = client.generateAuthUrl({
            access_type: 'offline', // Request refresh token
            scope: SCOPES,
            prompt: 'consent', // Force consent screen even if previously authorized
        });
        console.log('Authorize this app by visiting this url:', authUrl);
        // Start a local server to listen for the redirect
        const server = http.createServer(async (req, res) => {
            try {
                if (!req.url) {
                    throw new Error('Request URL is undefined');
                }
                const parsedUrl = url.parse(req.url, true);
                const callbackPath = url.parse(REDIRECT_URI).pathname; // Get path from REDIRECT_URI
                if (parsedUrl.pathname === callbackPath) { // Compare with dynamic callback path
                    const code = parsedUrl.query.code;
                    if (!code) {
                        res.end('Authentication failed. No code received.');
                        server.close();
                        return reject(new Error('Authentication failed. No code received.'));
                    }
                    console.log('Received authorization code. Fetching tokens...');
                    const { tokens } = await client.getToken(code);
                    client.setCredentials(tokens);
                    console.log('Tokens received.');
                    await saveCredentials(client);
                    console.log('Credentials saved.');
                    res.end('Authentication successful! You can close this tab.');
                    server.close();
                    resolve(client);
                }
                else {
                    res.writeHead(404);
                    res.end('Not Found');
                }
            }
            catch (e) {
                console.error('Error during OAuth callback:', e);
                res.writeHead(500);
                res.end('Authentication failed.');
                server.close();
                reject(e);
            }
        }).listen(3000, () => {
            // Open the authorization URL in the default browser
            open(authUrl).catch(err => {
                console.error("Failed to open browser automatically. Please copy/paste the URL above.", err);
            });
            console.log(`Server listening on ${REDIRECT_URI.replace(/\/oauth2callback$/, '')}`); // Log base URL
        });
        server.on('error', (err) => {
            console.error("Server error:", err);
            reject(err);
        });
    });
}
/**
 * Lists the next 10 events on the user's primary calendar.
 * @param auth An authorized OAuth2 client.
 */
async function listEventsForDay(auth, targetDate) {
    const calendar = google.calendar({ version: 'v3', auth });
    // Calculate timeMin (start of the target day)
    const timeMin = new Date(targetDate);
    timeMin.setHours(0, 0, 0, 0); // Set to 00:00:00.000 of the target day
    // Calculate timeMax (start of the *next* day)
    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMin.getDate() + 1); // Set to 00:00:00.000 of the *next* day
    console.log(`Fetching events for ${targetDate.toDateString()} (from ${timeMin.toISOString()} to ${timeMax.toISOString()})`);
    try {
        const res = await calendar.events.list({
            calendarId: 'primary', // Use 'primary' for the user's main calendar
            timeMin: timeMin.toISOString(), // Start of the target day in ISO format
            timeMax: timeMax.toISOString(), // Start of the next day in ISO format (exclusive)
            singleEvents: true, // Treat recurring events as individual instances
            orderBy: 'startTime', // Sort by start time
            // maxResults is removed to get all events for the day
        });
        const events = res.data.items;
        if (!events || events.length === 0) {
            console.log(`No events found for ${targetDate.toDateString()}.`);
            return []; // Return empty array if no events
        }
        console.log(`Events for ${targetDate.toDateString()}:`);
        events.forEach((event) => {
            const start = event.start?.dateTime || event.start?.date; // Handle all-day events
            const summary = event.summary || '(No title)';
            console.log(`- ${start} - ${summary}`);
        });
        return events; // Return the fetched events
    }
    catch (err) {
        console.error('The API returned an error: ', err);
        // Error handling for invalid credentials (same as before)
        if (err.code === 401 || (err.response?.data?.error === 'invalid_grant')) {
            console.error(`Authentication error. You might need to delete the token file at ${TOKEN_PATH} and re-run the script.`);
            try {
                await fs.unlink(TOKEN_PATH);
                console.log(`Deleted potentially invalid token file: ${TOKEN_PATH}`);
            }
            catch (deleteErr) {
                if (deleteErr.code !== 'ENOENT') {
                    console.error(`Failed to delete token file: ${deleteErr}`);
                }
            }
        }
        return undefined; // Return undefined in case of API error
    }
}
// Main execution function
async function main() {
    try {
        console.log('Authenticating using credentials from .env file...');
        const authClient = await authorize();
        console.log('Authentication successful.');
        console.log('\nFetching calendar events...');
        // --- Specify the date you want to fetch events for ---
        const specificDay = new Date(); // Example: Get events for TODAY
        // Or for a specific date:
        // const specificDay = new Date('2025-05-15'); // Year-Month-Day
        console.log(`\nFetching calendar events for ${specificDay.toDateString()}...`);
        const events = await listEventsForDay(authClient, specificDay);
        console.error(events);
        return authClient;
    }
    catch (error) {
        console.error('An error occurred:', error);
        process.exit(1); // Exit with error code
    }
}
// --- Run the main function ---
main();
export { main, listEventsForDay };
