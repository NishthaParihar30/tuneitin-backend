/**
 * POST /api/spotify/export
 * Creates a Spotify playlist and adds all songs to it
 *
 * Body: { accessToken, mood, songs: [{name, artist, spotifyId}] }
 * Returns: { success, playlistUrl, playlistName, tracksAdded }
 */

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://tuneitin.netlify.app';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const { accessToken, mood, songs } = req.body;

    if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });
    if (!songs || !songs.length) return res.status(400).json({ error: 'No songs provided' });

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json'
    };

    try {
        // ── STEP 1: Get the user's Spotify ID ──────────────────────────────
        const meRes  = await fetch('https://api.spotify.com/v1/me', { headers });
        const meData = await meRes.json();

        if (!meData.id) {
            console.error('❌ Could not get Spotify user ID:', meData);
            return res.status(401).json({ error: 'Invalid Spotify token or expired. Please re-authenticate.' });
        }

        const userId = meData.id;
        console.log(`✅ Spotify user: ${userId}`);

        // ── STEP 2: Create an empty playlist ───────────────────────────────
        const moodEmoji = {
            happy:'😊', sad:'😢', energetic:'💪', calm:'😌',
            romantic:'❤️', angry:'😤', nostalgic:'🌅', focus:'🎯'
        }[mood] || '🎵';

        const moodCapitalized = mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'My';
        const playlistName    = `${moodEmoji} ${moodCapitalized} Vibes — TuneItIn`;
        const playlistDesc    = `A ${mood} playlist created by TuneItIn AI • ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}`;

        const createRes  = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
            method:  'POST',
            headers,
            body:    JSON.stringify({
                name:        playlistName,
                description: playlistDesc,
                public:      false
            })
        });
        const playlist = await createRes.json();

        if (!playlist.id) {
            console.error('❌ Failed to create playlist:', playlist);
            return res.status(500).json({ error: 'Failed to create Spotify playlist' });
        }

        const playlistId  = playlist.id;
        const playlistUrl = playlist.external_urls.spotify;
        console.log(`✅ Created playlist: ${playlistName} (${playlistId})`);

        // ── STEP 3: Search for each song and collect URIs ──────────────────
        const trackUris = [];

        for (const song of songs) {
            try {
                // If we already have a Spotify ID from the Last.fm → Spotify pipeline, use it directly
                if (song.spotifyId) {
                    trackUris.push(`spotify:track:${song.spotifyId}`);
                    console.log(`  ✅ Direct ID: ${song.name}`);
                    continue;
                }

                // Otherwise search Spotify
                const query     = encodeURIComponent(`track:${song.name} artist:${song.artist}`);
                const searchRes = await fetch(
                    `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
                    { headers }
                );
                const searchData = await searchRes.json();
                const track      = searchData?.tracks?.items?.[0];

                if (track) {
                    trackUris.push(track.uri);
                    console.log(`  ✅ Found: ${song.name} → ${track.uri}`);
                } else {
                    // Fallback: try a looser search (just title)
                    const looseQuery   = encodeURIComponent(song.name);
                    const looseRes     = await fetch(
                        `https://api.spotify.com/v1/search?q=${looseQuery}&type=track&limit=1`,
                        { headers }
                    );
                    const looseData    = await looseRes.json();
                    const looseTrack   = looseData?.tracks?.items?.[0];

                    if (looseTrack) {
                        trackUris.push(looseTrack.uri);
                        console.log(`  ⚠️ Loose match: ${song.name} → ${looseTrack.uri}`);
                    } else {
                        console.log(`  ❌ Not found on Spotify: ${song.name} by ${song.artist}`);
                    }
                }
            } catch(searchErr) {
                console.error(`  ❌ Search error for "${song.name}":`, searchErr.message);
            }
        }

        console.log(`📊 Found ${trackUris.length} / ${songs.length} tracks on Spotify`);

        if (trackUris.length === 0) {
            return res.status(200).json({
                success:      false,
                error:        'None of the songs could be found on Spotify',
                playlistUrl,
                playlistName,
                tracksAdded:  0
            });
        }

        // ── STEP 4: Add tracks to playlist (max 100 per request) ──────────
        let tracksAdded = 0;
        const CHUNK = 100;

        for (let i = 0; i < trackUris.length; i += CHUNK) {
            const chunk   = trackUris.slice(i, i + CHUNK);
            const addRes  = await fetch(
                `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
                {
                    method:  'POST',
                    headers,
                    body:    JSON.stringify({ uris: chunk })
                }
            );
            const addData = await addRes.json();

            if (addData.snapshot_id) {
                tracksAdded += chunk.length;
                console.log(`✅ Added batch of ${chunk.length} tracks`);
            } else {
                console.error('❌ Failed to add batch:', addData);
            }
        }

        // ── STEP 5: Return success ─────────────────────────────────────────
        console.log(`🎉 Export complete: ${tracksAdded} tracks added to "${playlistName}"`);
        return res.status(200).json({
            success:     true,
            playlistUrl,
            playlistName,
            tracksAdded
        });

    } catch(err) {
        console.error('❌ Export handler error:', err);
        return res.status(500).json({ error: 'Internal server error: ' + err.message });
    }
}
