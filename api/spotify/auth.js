/**
 * GET /api/spotify/auth
 * Redirects user to Spotify login page
 */

const SPOTIFY_ID    = process.env.SPOTIFY_CLIENT_ID;
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const scopes = [
        'playlist-modify-public',
        'playlist-modify-private',
        'user-read-private',
        'user-read-email'
    ].join(' ');

    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     SPOTIFY_ID,
        scope:         scopes,
        redirect_uri:  REDIRECT_URI,
        show_dialog:   'false'
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
}
