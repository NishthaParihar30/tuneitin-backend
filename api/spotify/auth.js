/**
 * GET /api/spotify/auth
 * Redirects user to Spotify login page
 */

const SPOTIFY_ID   = process.env.SPOTIFY_CLIENT_ID;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Guard: catch missing env vars early with a clear error
    if (!SPOTIFY_ID || !REDIRECT_URI) {
        console.error('❌ Missing env vars:', {
            SPOTIFY_CLIENT_ID: !!SPOTIFY_ID,
            SPOTIFY_REDIRECT_URI: !!REDIRECT_URI
        });
        return res.status(500).json({
            error: 'Server misconfiguration: missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI'
        });
    }

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
        show_dialog:   'true'   // ✅ FIXED: was 'false' — caused silent auto-auth, skipping login page
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params}`;
    console.log('🔗 Redirecting to Spotify auth:', authUrl);
    res.redirect(authUrl);
}
