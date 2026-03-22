/**
 * POST /api/spotify/refresh
 * Refreshes an expired Spotify access token
 *
 * Body: { refreshToken: string }
 */

const SPOTIFY_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'No refresh token provided' });

    try {
        const creds    = Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64');
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method:  'POST',
            headers: {
                'Authorization': `Basic ${creds}`,
                'Content-Type':  'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type:    'refresh_token',
                refresh_token: refreshToken
            })
        });

        const data = await tokenRes.json();

        if (data.error) {
            return res.status(401).json({ error: data.error_description || data.error });
        }

        return res.status(200).json({
            accessToken: data.access_token,
            expiresIn:   data.expires_in
        });

    } catch(err) {
        console.error('Refresh error:', err);
        return res.status(500).json({ error: 'Failed to refresh token' });
    }
}