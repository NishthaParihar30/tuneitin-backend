/**
 * POST /api/spotify/export
 * Creates a Spotify playlist and adds all songs to it
 *
 * Body: { accessToken, mood, songs: [{name, artist, spotifyId}] }
 * Returns: { success, playlistUrl, playlistName, tracksAdded }
 */

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://tuneitin.netlify.app';

// Safe JSON parser — Spotify sometimes returns plain text errors
async function safeJson(res) {
    const text = await res.text();
    try {
        return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch(e) {
        return { ok: res.ok, status: res.status, data: null, raw: text };
    }
}

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
        // ── STEP 1: Get the user's Spotify ID ──────────────────
        const me = await safeJson(await fetch('https://api.spotify.com/v1/me', { headers }));

        if (!me.ok || !me.data?.id) {
            const errMsg = me.raw || me.data?.error?.message || 'Could not get Spotify user';
            console.error('❌ /me failed:', errMsg);
            return res.status(me.status || 500).json({ error: errMsg });
        }

        const userId = me.data.id;
        console.log(`✅ Spotify user: ${userId}`);

        // ── STEP 2: Create empty playlist ──────────────────────
        const moodEmoji = {
            happy:'😊', sad:'😢', energetic:'💪', calm:'😌',
            romantic:'❤️', angry:'😤', nostalgic:'🌅', focus:'🎯'
        }[mood] || '🎵';

        const playlistName = `${moodEmoji} ${mood ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'My'} Vibes — TuneItIn`;
        const playlistDesc = `A ${mood} playlist created by TuneItIn AI • ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}`;

        const created = await safeJson(
            await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
                method:  'POST',
                headers,
                body:    JSON.stringify({ name: playlistName, description: playlistDesc, public: false })
            })
        );

        if (!created.ok || !created.data?.id) {
            const errMsg = created.raw || created.data?.error?.message || 'Failed to create playlist';
            console.error('❌ Create playlist failed:', errMsg);
            return res.status(500).json({ error: errMsg });
        }

        const playlistId  = created.data.id;
        const playlistUrl = created.data.external_urls.spotify;
        console.log(`✅ Created playlist: ${playlistName}`);

        // ── STEP 3: Search each song and collect URIs ──────────
        const trackUris = [];

        for (const song of songs) {
            try {
                // Use spotifyId directly if available
                if (song.spotifyId) {
                    trackUris.push(`spotify:track:${song.spotifyId}`);
                    continue;
                }

                // Search by track + artist
                const q1 = await safeJson(
                    await fetch(
                        `https://api.spotify.com/v1/search?q=${encodeURIComponent(`track:${song.name} artist:${song.artist}`)}&type=track&limit=1`,
                        { headers }
                    )
                );

                const track1 = q1.data?.tracks?.items?.[0];
                if (track1) {
                    trackUris.push(track1.uri);
                    console.log(`  ✅ Found: ${song.name}`);
                    continue;
                }

                // Fallback: search by title only
                const q2 = await safeJson(
                    await fetch(
                        `https://api.spotify.com/v1/search?q=${encodeURIComponent(song.name)}&type=track&limit=1`,
                        { headers }
                    )
                );

                const track2 = q2.data?.tracks?.items?.[0];
                if (track2) {
                    trackUris.push(track2.uri);
                    console.log(`  ⚠️ Loose match: ${song.name}`);
                } else {
                    console.log(`  ❌ Not found: ${song.name}`);
                }

            } catch(e) {
                console.error(`  ❌ Search error for "${song.name}":`, e.message);
            }
        }

        console.log(`📊 Found ${trackUris.length}/${songs.length} tracks`);

        if (trackUris.length === 0) {
            return res.status(200).json({
                success: false,
                error: 'None of the songs could be found on Spotify',
                playlistUrl,
                playlistName,
                tracksAdded: 0
            });
        }

        // ── STEP 4: Add tracks to playlist (max 100 per call) ──
        let tracksAdded = 0;
        for (let i = 0; i < trackUris.length; i += 100) {
            const chunk  = trackUris.slice(i, i + 100);
            const added  = await safeJson(
                await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                    method:  'POST',
                    headers,
                    body:    JSON.stringify({ uris: chunk })
                })
            );
            if (added.data?.snapshot_id) {
                tracksAdded += chunk.length;
                console.log(`✅ Added ${chunk.length} tracks`);
            } else {
                console.error('❌ Failed to add batch:', added.raw || added.data);
            }
        }

        // ── STEP 5: Return success ──────────────────────────────
        console.log(`🎉 Done: ${tracksAdded} tracks in "${playlistName}"`);
        return res.status(200).json({
            success: true,
            playlistUrl,
            playlistName,
            tracksAdded
        });

    } catch(err) {
        console.error('❌ Export handler error:', err);
        return res.status(500).json({ error: 'Internal server error: ' + err.message });
    }
}
