/**
 * TuneItIn — Spotify Export
 * File: js/spotifyExport.js
 *
 * SIMPLE FLOW:
 * 1. User clicks Export button
 * 2. If not connected → redirect to Spotify login (saves playlist first)
 * 3. Spotify sends user back → token saved → playlist restored → auto export
 * 4. Export calls Vercel backend → creates playlist → shows success banner
 */

// ── Call this inside init() in app.js ──
function initSpotifyFeature() {
    // Check if Spotify just sent user back with token in URL
    const justConnected = lastfmAPI.handleSpotifyCallback();

    if (justConnected) {
        showToast('🎵 Spotify connected!');

        // Restore playlist that was saved before the redirect
        const raw = sessionStorage.getItem('tuneitin_pending_export');
        if (raw) {
            try {
                const saved = JSON.parse(raw);
                sessionStorage.removeItem('tuneitin_pending_export');

                if (saved.songs && saved.songs.length > 0) {
                    // Put songs back into global state
                    currentPlaylist = saved.songs;
                    currentAnalysis = currentAnalysis || { mood: saved.mood };

                    // Show the playlist on screen
                    if (typeof displayPlaylist === 'function') displayPlaylist();

                    // Export automatically after short delay
                    showToast('⏳ Exporting your playlist to Spotify…');
                    setTimeout(() => runExport(saved.mood, saved.songs), 2000);
                    return;
                }
            } catch(e) {
                console.error('Failed to restore pending export:', e);
            }
        }
        return;
    }

    // Already connected from earlier — just log it
    if (lastfmAPI.isSpotifyConnected()) {
        console.log('✅ Spotify already connected');
    }
}


// ── Called when user clicks Export button ──
async function exportCurrentPlaylist() {
    // Safety check — make sure we have songs
    if (!currentPlaylist || currentPlaylist.length === 0) {
        showToast('⚠️ Generate a playlist first!');
        return;
    }

    const mood  = (currentAnalysis && currentAnalysis.mood) ? currentAnalysis.mood : 'happy';
    const songs = currentPlaylist.slice(); // copy array

    // If NOT connected → save playlist and go to Spotify login
    if (!lastfmAPI.isSpotifyConnected()) {
        // Save playlist so we can restore it after redirect
        sessionStorage.setItem('tuneitin_pending_export', JSON.stringify({
            mood:  mood,
            songs: songs.map(s => ({
                name:      s.name      || '',
                artist:    s.artist    || '',
                spotifyId: s.spotifyId || s.trackId || null
            }))
        }));

        showToast('🔑 Redirecting to Spotify login…');

        // Small delay so toast is visible, then redirect
        setTimeout(() => {
            window.location.href = lastfmAPI.backendUrl + '/api/spotify/auth';
        }, 800);
        return;
    }

    // Already connected → export directly
    await runExport(mood, songs);
}


// ── Actually send to Vercel and create the playlist ──
async function runExport(mood, songs) {
    const btn = document.getElementById('exportSpotifyBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Exporting…'; }

    const token = lastfmAPI.spotifyAccessToken;

    if (!token) {
        showToast('❌ No Spotify token. Please try again.');
        if (btn) { btn.disabled = false; btn.innerHTML = '🎵 Export to Spotify'; }
        return;
    }

    try {
        const payload = {
            accessToken: token,
            mood:        mood,
            songs:       songs.map(s => ({
                name:      s.name      || '',
                artist:    s.artist    || '',
                spotifyId: s.spotifyId || s.trackId || null
            }))
        };

        console.log('📤 Sending to Vercel:', lastfmAPI.backendUrl + '/api/spotify/export');
        console.log('📦 Songs count:', songs.length, '| Mood:', mood);

        const response = await fetch(lastfmAPI.backendUrl + '/api/spotify/export', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });

        console.log('📥 Response status:', response.status);
        const data = await response.json();
        console.log('📥 Response data:', data);

        if (data.success) {
            showToast('✅ ' + data.tracksAdded + ' songs exported to Spotify!');
            showExportBanner(data.playlistUrl, data.playlistName, data.tracksAdded);
            if (btn) {
                btn.disabled         = false;
                btn.innerHTML        = '✅ Exported!';
                btn.style.background = 'linear-gradient(135deg, #1DB954, #1ed760)';
            }
        } else {
            console.error('Export failed:', data.error);
            showToast('❌ Export failed: ' + (data.error || 'Unknown error'));
            if (btn) { btn.disabled = false; btn.innerHTML = '🎵 Export to Spotify'; }
        }

    } catch(err) {
        console.error('Export network error:', err);
        showToast('❌ Network error: ' + err.message);
        if (btn) { btn.disabled = false; btn.innerHTML = '🎵 Export to Spotify'; }
    }
}


// ── Green success banner ──
function showExportBanner(url, name, count) {
    const old = document.getElementById('exportBanner');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id    = 'exportBanner';
    div.style.cssText = [
        'position:fixed', 'bottom:80px', 'left:50%',
        'transform:translateX(-50%)',
        'background:linear-gradient(135deg,#1DB954,#1ed760)',
        'color:white', 'padding:16px 24px', 'border-radius:16px',
        'box-shadow:0 8px 32px rgba(29,185,84,0.4)',
        'font-weight:700', 'font-size:0.9em', 'z-index:9999',
        'display:flex', 'align-items:center', 'gap:14px', 'max-width:90vw'
    ].join(';');

    div.innerHTML =
        '<span style="font-size:1.5em">🎵</span>' +
        '<div>' +
            '<div>' + count + ' songs saved to Spotify!</div>' +
            '<div style="font-weight:400;font-size:0.85em;opacity:0.9">' + name + '</div>' +
        '</div>' +
        '<a href="' + url + '" target="_blank" ' +
           'style="background:white;color:#1DB954;padding:8px 16px;border-radius:20px;' +
                  'text-decoration:none;font-weight:700;font-size:0.85em;white-space:nowrap">' +
            'Open ↗' +
        '</a>' +
        '<button onclick="document.getElementById(\'exportBanner\').remove()" ' +
                'style="background:none;border:none;color:white;font-size:1.2em;cursor:pointer">✕</button>';

    document.body.appendChild(div);
    setTimeout(function() {
        var b = document.getElementById('exportBanner');
        if (b) b.remove();
    }, 15000);
}
