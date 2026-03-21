/**
 * TuneItIn Backend — Spotify Export System
 *
 * Two endpoints:
 *   GET  /api/spotify/auth     → Redirect user to Spotify login
 *   GET  /api/spotify/callback → Handle OAuth callback, return token to frontend
 *   POST /api/spotify/export   → Create playlist + add tracks to user's Spotify
 *
 * This uses Spotify Authorization Code Flow (user gives permission to create playlists)
 * Different from Client Credentials — this acts ON BEHALF of the user
 *
 * Setup in Spotify Developer Dashboard:
 *   1. Go to developer.spotify.com → your app → Edit Settings
 *   2. Add Redirect URI: https://your-vercel-app.vercel.app/api/spotify/callback
 *   3. Add scopes: playlist-modify-public, playlist-modify-private
 */

const SPOTIFY_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI   = process.env.SPOTIFY_REDIRECT_URI; // your vercel URL + /api/spotify/callback
const FRONTEND_URL   = process.env.FRONTEND_URL;         // your netlify URL

// ─────────────────────────────────────────────
// GET /api/spotify/auth
// Redirects user to Spotify login page
// ─────────────────────────────────────────────
export async function authHandler(req, res) {
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
        state:         Math.random().toString(36).substring(7), // CSRF protection
        show_dialog:   'false'
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
}

// ─────────────────────────────────────────────
// GET /api/spotify/callback
// Spotify redirects here after user logs in
// Exchanges auth code for access + refresh tokens
// Sends tokens back to frontend via URL params
// ─────────────────────────────────────────────
export async function callbackHandler(req, res) {
    const { code, error } = req.query;

    if (error) {
        return res.redirect(`${FRONTEND_URL}?spotify_error=${error}`);
    }

    try {
        const creds = Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64');
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

        // Send tokens to frontend via URL — frontend stores in memory (not localStorage for security)
        // In production, use httpOnly cookies instead
        const params = new URLSearchParams({
            spotify_access_token:  tokens.access_token,
            spotify_refresh_token: tokens.refresh_token,
            spotify_expires_in:    tokens.expires_in
        });

        res.redirect(`${FRONTEND_URL}?${params}`);

    } catch(err) {
        console.error('Callback error:', err);
        res.redirect(`${FRONTEND_URL}?spotify_error=server_error`);
    }
}

// ─────────────────────────────────────────────
// POST /api/spotify/export
// Creates a Spotify playlist and adds songs
//
// Body: {
//   accessToken: "user's spotify token",
//   mood: "happy",
//   songs: [{ name, artist, spotifyId }],
//   playlistName: "My Happy Playlist"  // optional
// }
// ─────────────────────────────────────────────
export async function exportHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

    const { accessToken, mood, songs, playlistName } = req.body;

    if (!accessToken) return res.status(401).json({ error: 'No Spotify access token' });
    if (!songs?.length) return res.status(400).json({ error: 'No songs to export' });

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json'
    };

    try {
        // Step 1 — Get user's Spotify ID
        const profileRes = await fetch('https://api.spotify.com/v1/me', { headers });
        const profile    = await profileRes.json();
        if (!profile.id) return res.status(401).json({ error: 'Invalid Spotify token' });

        // Step 2 — Create a new playlist
        const MOOD_EMOJIS = { happy:'😊', sad:'😢', energetic:'💪', calm:'😌', romantic:'❤️', angry:'😤', nostalgic:'🌅', focus:'🎯' };
        const name        = playlistName || `${MOOD_EMOJIS[mood] || '🎵'} ${mood.charAt(0).toUpperCase() + mood.slice(1)} — TuneItIn`;
        const desc        = `Generated by TuneItIn · tuneitin.app · ${new Date().toLocaleDateString()}`;

        const createRes = await fetch(`https://api.spotify.com/v1/users/${profile.id}/playlists`, {
            method:  'POST',
            headers,
            body:    JSON.stringify({ name, description: desc, public: false })
        });
        const playlist = await createRes.json();
        if (!playlist.id) return res.status(500).json({ error: 'Failed to create playlist' });

        // Step 3 — Search for songs that don't have a spotifyId yet
        const tracksWithIds = await Promise.allSettled(
            songs.map(async song => {
                if (song.spotifyId) return `spotify:track:${song.spotifyId}`;

                // Search by name + artist
                const q   = encodeURIComponent(`track:"${song.name}" artist:"${song.artist}"`);
                const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, { headers });
                const data = await res.json();
                const id   = data?.tracks?.items?.[0]?.id;
                return id ? `spotify:track:${id}` : null;
            })
        );

        const uris = tracksWithIds
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);

        if (!uris.length) return res.status(400).json({ error: 'Could not find any songs on Spotify' });

        // Step 4 — Add tracks to playlist (max 100 per request)
        for (let i = 0; i < uris.length; i += 100) {
            await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
                method:  'POST',
                headers,
                body:    JSON.stringify({ uris: uris.slice(i, i + 100) })
            });
        }

        return res.status(200).json({
            success:      true,
            playlistId:   playlist.id,
            playlistUrl:  playlist.external_urls?.spotify,
            playlistName: name,
            tracksAdded:  uris.length,
        });

    } catch(err) {
        console.error('Export error:', err);
        return res.status(500).json({ error: 'Failed to export playlist. Please try again.' });
    }
}

// ─────────────────────────────────────────────
// POST /api/spotify/refresh
// Refresh an expired access token
// ─────────────────────────────────────────────
export async function refreshHandler(req, res) {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'No refresh token' });

    const creds = Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method:  'POST',
        headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
    });
    const data = await tokenRes.json();
    if (data.error) return res.status(401).json({ error: data.error });
    return res.status(200).json({ accessToken: data.access_token, expiresIn: data.expires_in });
}

// Route dispatcher — Vercel calls this file for /api/spotify/*
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const path = req.url.replace('/api/spotify', '');
    if (path === '/auth')         return authHandler(req, res);
    if (path === '/callback')     return callbackHandler(req, res);
    if (path === '/export')       return exportHandler(req, res);
    if (path === '/refresh')      return refreshHandler(req, res);
    return res.status(404).json({ error: 'Not found' });
}