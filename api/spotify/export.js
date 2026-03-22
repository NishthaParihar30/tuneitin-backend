/**
 * TuneItIn — Spotify Export Feature
 * Add this as js/spotifyExport.js and include in index.html after app.js
 */

let spotifyConnected = false;

// ─────────────────────────────────────────────────────────
// Call inside your init() function in app.js
// ─────────────────────────────────────────────────────────
function initSpotifyFeature() {
    const connected = lastfmAPI.handleSpotifyCallback();
    if (connected) {
        spotifyConnected = true;
        showToast('🎵 Spotify connected! You can now export playlists.');
        updateSpotifyButton();

        // Restore pending export saved before the Spotify redirect
        const pendingRaw = sessionStorage.getItem('tuneitin_pending_export');
        if (pendingRaw) {
            try {
                const pending = JSON.parse(pendingRaw);
                sessionStorage.removeItem('tuneitin_pending_export');
                if (pending.songs && pending.songs.length > 0) {
                    currentPlaylist = pending.songs;
                    currentAnalysis = { mood: pending.mood };
                    setTimeout(() => doExport(pending.mood, pending.songs), 1500);
                }
            } catch(e) {
                console.error('Could not restore pending export:', e);
            }
        }
    }

    if (lastfmAPI.isSpotifyConnected()) {
        spotifyConnected = true;
        updateSpotifyButton();
    }
}


// ─────────────────────────────────────────────────────────
// Called when user clicks Export button
// ─────────────────────────────────────────────────────────
async function exportCurrentPlaylist() {
    if (!currentPlaylist || currentPlaylist.length === 0) {
        showToast('⚠️ Generate a playlist first!');
        return;
    }

    const mood  = currentAnalysis?.mood || 'happy';
    const songs = currentPlaylist;

    if (!lastfmAPI.isSpotifyConnected()) {
        // Save playlist before redirecting to Spotify login
        sessionStorage.setItem('tuneitin_pending_export', JSON.stringify({
            mood,
            songs: songs.map(s => ({
                name:      s.name,
                artist:    s.artist,
                spotifyId: s.spotifyId || s.trackId || null
            }))
        }));
        showToast('🔑 Connecting to Spotify…');
        window.location.href = `${lastfmAPI.backendUrl}/api/spotify/auth`;
        return;
    }

    await doExport(mood, songs);
}


// ─────────────────────────────────────────────────────────
// Send export request to Vercel backend
// ─────────────────────────────────────────────────────────
async function doExport(mood, songs) {
    const btn = document.getElementById('exportSpotifyBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Exporting…'; }

    try {
        const token = lastfmAPI.spotifyAccessToken;
        if (!token) {
            showToast('❌ Spotify token missing. Please try again.');
            if (btn) { btn.disabled = false; btn.innerHTML = '🎵 Export to Spotify'; }
            return;
        }

        const response = await fetch(`${lastfmAPI.backendUrl}/api/spotify/export`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                accessToken: token,
                mood:        mood,
                songs:       songs.map(s => ({
                    name:      s.name,
                    artist:    s.artist,
                    spotifyId: s.spotifyId || s.trackId || null
                }))
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`✅ ${data.tracksAdded} songs exported to Spotify!`);
            showExportSuccess(data.playlistUrl, data.playlistName, data.tracksAdded);
            if (btn) {
                btn.innerHTML        = '✅ Exported!';
                btn.style.background = 'linear-gradient(135deg, #1DB954, #1ed760)';
                btn.disabled         = false;
            }
        } else {
            console.error('Export error:', data.error);
            showToast(`❌ Export failed: ${data.error}`);
            if (btn) { btn.disabled = false; btn.innerHTML = '🎵 Export to Spotify'; }
        }

    } catch(err) {
        console.error('Network error:', err);
        showToast('❌ Network error. Please try again.');
        if (btn) { btn.disabled = false; btn.innerHTML = '🎵 Export to Spotify'; }
    }
}


// ─────────────────────────────────────────────────────────
// Green success banner with Open in Spotify link
// ─────────────────────────────────────────────────────────
function showExportSuccess(playlistUrl, playlistName, count) {
    const existing = document.getElementById('exportSuccessBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id    = 'exportSuccessBanner';
    banner.style.cssText = `
        position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
        background:linear-gradient(135deg,#1DB954,#1ed760);
        color:white; padding:16px 24px; border-radius:16px;
        box-shadow:0 8px 32px rgba(29,185,84,0.4);
        font-weight:700; font-size:0.9em; z-index:9999;
        display:flex; align-items:center; gap:14px; max-width:90vw;
    `;
    banner.innerHTML = `
        <span style="font-size:1.5em;">🎵</span>
        <div>
            <div>${count} songs saved to Spotify!</div>
            <div style="font-weight:400;font-size:0.85em;opacity:0.9;">${playlistName}</div>
        </div>
        <a href="${playlistUrl}" target="_blank"
           style="background:white;color:#1DB954;padding:8px 16px;border-radius:20px;
                  text-decoration:none;font-weight:700;font-size:0.85em;white-space:nowrap;">
            Open ↗
        </a>
        <button onclick="document.getElementById('exportSuccessBanner').remove()"
                style="background:none;border:none;color:white;font-size:1.2em;cursor:pointer;opacity:0.7;">✕</button>
    `;
    document.body.appendChild(banner);
    setTimeout(() => { const b = document.getElementById('exportSuccessBanner'); if(b) b.remove(); }, 12000);
}


// ─────────────────────────────────────────────────────────
// Update button text
// ─────────────────────────────────────────────────────────
function updateSpotifyButton() {
    const btn = document.getElementById('exportSpotifyBtn');
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = lastfmAPI.isSpotifyConnected()
        ? '🎵 Export to Spotify'
        : '🔗 Connect Spotify & Export';
}
