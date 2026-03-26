
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://tuneitin.netlify.app';

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const clientId = process.env.SPOTIFY_CLIENT_ID;

    if (!clientId) {
        console.error('❌ SPOTIFY_CLIENT_ID not set in Vercel env vars');
        return res.status(500).json({ error: 'Server misconfiguration' });
    }

    // Only return the client ID — never the secret
    return res.status(200).json({ clientId });
}
