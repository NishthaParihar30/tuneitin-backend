/**
 * GET /api/spotify/callback
 * Handles OAuth callback from Spotify
 * Exchanges auth code for tokens and redirects back to frontend
 */

const SPOTIFY_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI   = process.env.SPOTIFY_REDIRECT_URI;
const FRONTEND_URL   = process.env.FRONTEND_URL;

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    const { code, error } = req.query;

    if (error) {
        return res.redirect(`${FRONTEND_URL}?spotify_error=${error}`);
    }

    if (!code) {
        return res.redirect(`${FRONTEND_URL}?spotify_error=no_code`);
    }

    try {
        const creds    = Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64');
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method:  'POST',
            headers: {
                'Authorization': `Basic ${creds}`,
                'Content-Type':  'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type:   'authorization_code',
                code,
                redirect_uri: REDIRECT_URI
            })
        });

        const tokens = await tokenRes.json();

        if (tokens.error) {
            return res.redirect(`${FRONTEND_URL}?spotify_error=${tokens.error}`);
        }

        // Send tokens back to frontend via URL params
        // Frontend stores them in memory (never in localStorage)
        const params = new URLSearchParams({
            spotify_access_token:  tokens.access_token,
            spotify_refresh_token: tokens.refresh_token || '',
            spotify_expires_in:    tokens.expires_in
        });

        res.redirect(`${FRONTEND_URL}?${params}`);

    } catch(err) {
        console.error('Callback error:', err);
        res.redirect(`${FRONTEND_URL}?spotify_error=server_error`);
    }
}
