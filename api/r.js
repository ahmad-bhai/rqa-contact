export default async function handler(req, res) {
    // 1. Full CORS & Content Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    if (req.method === 'OPTIONS') {  
        return res.status(200).end();  
    }  

    try {  
        // 2. Safely Extract ID
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

        // Find Current User
        if (allUsers) {  
            for (let key in allUsers) {  
                if (allUsers[key] && String(allUsers[key].id).trim() === incomingId) {  
                    userKey = key;
                    userData = allUsers[key];
                    break;  
                }  
            }  
        }

        // 🚨 5. SECURITY CHECK 1: UNKNOWN IP / DEVICE / BOT BLOCK & DELETE
        if (isUnknownIP || isUnknownDevice || isBotOrCurl) {
            if (userKey) {
                await fetch(`${firebaseBaseURL}/users/${userKey}.json`, { method: 'DELETE' });
            }
            return res.status(200).send("LOCKED_SECURITY_VIOLATION");
        }

        // 🚨 6. SECURITY CHECK 2: MULTI-ACCOUNT PER IP DETECTION (1 IP = 1 ID)
        if (allUsers && clientIp && !isUnknownIP) {
            const usersWithSameIP = [];

            for (let key in allUsers) {
                const u = allUsers[key];
                if (!u) continue;

                let userLogs = [];
                if (u.logs && typeof u.logs === 'object') {
                    userLogs = Array.isArray(u.logs) ? u.logs : Object.values(u.logs);
                }

                const lastLogIP = userLogs[0]?.ip || u.lastIp;
                
                if (lastLogIP === clientIp) {
                    usersWithSameIP.push({ key, id: u.id });
                }
            }

            const uniqueIdsForIP = new Set(usersWithSameIP.map(item => item.id));
            
            if (uniqueIdsForIP.size > 1) {
                // Delete all violating accounts on same IP
                for (let item of usersWithSameIP) {
                    await fetch(`${firebaseBaseURL}/users/${item.key}.json`, { method: 'DELETE' });
                }
                return res.status(200).send("LOCKED_MULTIPLE_ACCOUNTS_DETECTED");
            }
        }

        // User does not exist in DB
        if (!userData || !userKey) {
            return res.status(200).send(incomingId);
        }

        const isUnlocked = userData.status === "active";

        // 7. LOGS & ENHANCED ADMIN TRACKING UPDATE
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

        existingLogs.unshift(currentLog);
        const updatedLogs = existingLogs.slice(0, 5);

        // Batch Update direct fields on User Object for Admin Panel Overview
        const adminMetaData = {
            lastSeen: now.toISOString(),
            lastIp: clientIp,
            lastDevice: `${os} | ${browser}`,
            userAgent: rawUserAgent,
            logs: updatedLogs
        };

        await fetch(`${firebaseBaseURL}/users/${userKey}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adminMetaData)
        });

        // 8. FINAL RESPONSE
        if (isUnlocked) {  
            return res.status(200).send("R");  
        } else {  
            return res.status(200).send(incomingId);  
        }  

    } catch (error) {  
        return res.status(200).send(req.query?.id || "Error");  
    }
}
