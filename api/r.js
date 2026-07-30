export default async function handler(req, res) {
    // 1. Full CORS Headers Setup
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    // Preflight OPTIONS Request Handle karna
    if (req.method === 'OPTIONS') {  
        return res.status(200).end();  
    }  

    try {  
        // 2. Safely Extract ID from Query Parameters
        let incomingId = null;
        if (req.query && req.query.id) {
            incomingId = req.query.id;
        } else {
            const parsedUrl = new URL(req.url, `http://${req.headers['host'] || 'localhost'}`);
            incomingId = parsedUrl.searchParams.get('id');
        }

        if (!incomingId) {  
            return res.status(200).send("No ID Provided");  
        }  

        incomingId = String(incomingId).trim();

        // 3. Advanced Device, OS, Browser & IP Extraction
        const rawUserAgent = req.headers['user-agent'] || '';
        const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

        // OS Detection
        let os = "Unknown OS";
        if (/windows nt/i.test(rawUserAgent)) os = "Windows PC";
        else if (/macintosh|mac os x/i.test(rawUserAgent)) os = "macOS";
        else if (/android/i.test(rawUserAgent)) os = "Android Mobile";
        else if (/iphone|ipad|ipod/i.test(rawUserAgent)) os = "iOS Device";
        else if (/linux/i.test(rawUserAgent)) os = "Linux";

        // Browser Detection
        let browser = "Unknown Browser";
        if (/edg/i.test(rawUserAgent)) browser = "Microsoft Edge";
        else if (/chrome|crios/i.test(rawUserAgent) && !/edg/i.test(rawUserAgent)) browser = "Google Chrome";
        else if (/safari/i.test(rawUserAgent) && !/chrome|crios/i.test(rawUserAgent)) browser = "Apple Safari";
        else if (/firefox|fxios/i.test(rawUserAgent)) browser = "Mozilla Firefox";

        const isUnknownIP = !clientIp || clientIp === 'Unknown IP' || clientIp === '127.0.0.1' || clientIp === '::1';
        const isUnknownDevice = os === "Unknown OS" || browser === "Unknown Browser" || !rawUserAgent;
        const isBotOrCurl = /curl|python|postman|insomnia|wget|bot|crawler|spider/i.test(rawUserAgent);

        const firebaseBaseURL = "https://rqa-bot-admin-default-rtdb.firebaseio.com";

        // 4. Fetch All Users from Firebase
        const fetchResponse = await fetch(`${firebaseBaseURL}/users.json`);  
        if (!fetchResponse.ok) {  
            return res.status(200).send(incomingId);  
        }  

        const allUsers = await fetchResponse.json();  
        let userKey = null;
        let userData = null;

        if (allUsers) {  
            for (let key in allUsers) {  
                if (allUsers[key] && String(allUsers[key].id).trim() === incomingId) {  
                    userKey = key;
                    userData = allUsers[key];
                    break;  
                }  
            }  
        }

        // 🚨 5. SECURITY CHECK: AGAR IP/DEVICE UNKNOWN HO YA BOT HO TO USER DELETE KARO
        if (isUnknownIP || isUnknownDevice || isBotOrCurl) {
            if (userKey) {
                // Firebase se User PERMANENT DELETE kar do
                await fetch(`${firebaseBaseURL}/users/${userKey}.json`, {
                    method: 'DELETE'
                });
            }
            // Block response
            return res.status(200).send("LOCKED_SECURITY_VIOLATION");
        }

        // Agar user database mein exist hi nahi karta
        if (!userData || !userKey) {
            return res.status(200).send(incomingId);
        }

        // Active / Unlocked Status Check
        const isUnlocked = userData.status === "active";

        // 6. LOGS CREATION & ROTATION (5 Logs Object Format)
        const now = new Date();
        const currentLog = {
            timestamp: now.toISOString(),
            date: now.toLocaleDateString('en-US', { timeZone: 'Asia/Karachi' }),
            time: now.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi' }),
            ip: clientIp,
            device: `${os} | ${browser}`,
            status: isUnlocked ? "Unlocked (Active)" : "Locked (Inactive)"
        };

        let existingLogs = [];
        if (userData.logs && typeof userData.logs === 'object') {
            existingLogs = Array.isArray(userData.logs) ? userData.logs : Object.values(userData.logs);
        }

        // Latest log sabse aage add karo aur last 5 maintain karo
        existingLogs.unshift(currentLog);
        const updatedLogs = existingLogs.slice(0, 5);

        // Firebase RTDB me Logs UPDATE/SAVE karo
        await fetch(`${firebaseBaseURL}/users/${userKey}/logs.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedLogs)
        });

        // 7. FINAL RESPONSE
        if (isUnlocked) {  
            return res.status(200).send("R");  
        } else {  
            return res.status(200).send(incomingId);  
        }  

    } catch (error) {  
        return res.status(200).send(req.query?.id || "Error");  
    }
          }
