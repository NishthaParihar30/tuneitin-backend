/**
 * TuneItIn Backend — /api/songs
 * Vercel Serverless Function
 *
 * Handles: mood-based song fetching from Last.fm + Spotify year filter
 * Keys are safe here — never exposed to the browser
 *
 * Deploy: push to GitHub → connect to Vercel → env vars in Vercel dashboard
 */

const LASTFM_KEY     = process.env.LASTFM_API_KEY;
const SPOTIFY_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Simple in-memory cache (per serverless instance, ~5 min TTL)
// For production upgrade to Upstash Redis (free tier)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Mood → Emotion tags (primary tag is always pure emotion) ──
const MOOD_TAGS = {
    happy:     ['happy',         'feel good',    'uplifting',     'joyful',       'sunny'       ],
    sad:       ['sad',           'melancholy',   'heartbreak',    'emotional',    'sorrowful'   ],
    energetic: ['energetic',     'workout',      'pump up',       'hype',         'power'       ],
    calm:      ['calm',          'relaxing',     'peaceful',      'chill',        'soothing'    ],
    romantic:  ['romantic',      'love songs',   'passionate',    'tender',       'intimate'    ],
    angry:     ['angry',         'aggressive',   'rage',          'furious',      'intense'     ],
    nostalgic: ['nostalgic',     '2000s',        '90s',           'early 2010s',  'retro'       ],
    focus:     ['focus',         'concentration','study',         'instrumental', 'productive'  ]
};

const MIN_YEAR          = 2015;
const NOSTALGIC_MIN_YEAR = 2000;

// Songs Last.fm consistently mis-tags — blocked per mood
const BLACKLIST = {
    'shameless':          ['nostalgic', 'calm', 'happy', 'focus'],
    'bad guy':            ['nostalgic', 'calm', 'romantic'],
    'lovely':             ['angry', 'energetic'],
    'drivers license':    ['happy', 'energetic', 'angry'],
    'good 4 u':           ['sad', 'calm', 'romantic'],
    'wrecking ball':      ['happy', 'calm', 'focus'],
};

// ── Spotify token cache ──
let spotifyToken    = null;
let spotifyTokenExp = 0;

async function getSpotifyToken() {
    if (spotifyToken && Date.now() < spotifyTokenExp) return spotifyToken;
    const creds = Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64');
    const res   = await fetch('https://accounts.spotify.com/api/token', {
        method:  'POST',
        headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'grant_type=client_credentials'
    });
    const data      = await res.json();
    spotifyToken    = data.access_token;
    spotifyTokenExp = Date.now() + (data.expires_in - 60) * 1000;
    return spotifyToken;
}

// ── Last.fm: fetch mood-tagged tracks ──
async function fetchLastfmTracks(mood) {
    const tags       = MOOD_TAGS[mood] || [mood];
    const primaryTag = tags[0];
    const extraTags  = tags.slice(1, 3);
    const raw        = [];

    // Primary tag — 2 pages
    for (const page of [1, 2]) {
        try {
            const url = `https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(primaryTag)}&api_key=${LASTFM_KEY}&format=json&limit=30&page=${page}`;
            const res  = await fetch(url);
            const data = await res.json();
            const arr  = data?.tracks?.track;
            if (arr) raw.push(...(Array.isArray(arr) ? arr : [arr]));
        } catch(e) { /* skip */ }
    }

    // Extra emotion tags — 1 page each
    for (const tag of extraTags) {
        try {
            const url = `https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&api_key=${LASTFM_KEY}&format=json&limit=15&page=1`;
            const res  = await fetch(url);
            const data = await res.json();
            const arr  = data?.tracks?.track;
            if (arr) raw.push(...(Array.isArray(arr) ? arr : [arr]));
        } catch(e) { /* skip */ }
    }

    // Deduplicate + normalise + apply blacklist
    const seen   = new Set();
    const tracks = [];
    for (const t of raw) {
        if (!t?.name || !t?.artist) continue;
        const artist    = typeof t.artist === 'object' ? (t.artist.name || '') : t.artist;
        const key       = `${t.name.toLowerCase()}::${artist.toLowerCase()}`;
        if (seen.has(key)) continue;

        // Blacklist check
        const blocked = BLACKLIST[t.name.toLowerCase()];
        if (blocked?.includes(mood)) continue;

        seen.add(key);
        tracks.push({ name: t.name, artist, listeners: parseInt(t.listeners) || 0 });
    }

    // Shuffle for variety
    return tracks.sort(() => Math.random() - 0.5).slice(0, 40);
}

// ── Spotify: verify track + get release year, album art, preview, link ──
async function enrichWithSpotify(tracks, minYear) {
    const token = await getSpotifyToken();
    if (!token) {
        // No Spotify — return tracks with YouTube URLs only
        return tracks.map(t => ({
            ...t,
            year:       null,
            spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(`${t.name} ${t.artist}`)}`,
            albumArt:   null,
            previewUrl: null,
            youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.name} ${t.artist} official`)}`,
        }));
    }

    // Fire all Spotify searches in parallel — fast (~1-2s for 40 tracks)
    const results = await Promise.allSettled(
        tracks.map(async t => {
            const q   = encodeURIComponent(`track:"${t.name}" artist:"${t.artist}"`);
            const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=3`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data  = await res.json();
            const items = data?.tracks?.items || [];
            if (!items.length) return null;
            const match = items.find(i => i.artists.some(a => a.name.toLowerCase() === t.artist.toLowerCase())) || items[0];
            return {
                year:       parseInt((match.album.release_date || '').slice(0, 4)) || null,
                spotifyUrl: match.external_urls?.spotify || null,
                albumArt:   match.album.images?.[1]?.url || match.album.images?.[0]?.url || null,
                previewUrl: match.preview_url || null,
                spotifyId:  match.id,
                albumName:  match.album.name || null,
            };
        })
    );

    const verified = [];
    results.forEach((r, i) => {
        const t       = tracks[i];
        const spotify = r.status === 'fulfilled' ? r.value : null;
        const year    = spotify?.year ?? null;

        // Drop if confirmed older than minYear
        if (year !== null && year < minYear) return;

        verified.push({
            ...t,
            year,
            spotifyUrl:  spotify?.spotifyUrl  || `https://open.spotify.com/search/${encodeURIComponent(`${t.name} ${t.artist}`)}`,
            albumArt:    spotify?.albumArt    || null,
            previewUrl:  spotify?.previewUrl  || null,
            spotifyId:   spotify?.spotifyId   || null,
            albumName:   spotify?.albumName   || null,
            youtubeUrl:  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.name} ${t.artist} official`)}`,
            source:      'lastfm+spotify',
        });
    });

    return verified;
}

// ── Main handler ──
export default async function handler(req, res) {
    // CORS — allow your Netlify frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

    const mood = req.query.mood?.toLowerCase();
    if (!mood || !MOOD_TAGS[mood]) {
        return res.status(400).json({ error: `Invalid mood. Must be one of: ${Object.keys(MOOD_TAGS).join(', ')}` });
    }

    // Rate limiting — simple IP-based (upgrade to Redis for production)
    const ip      = req.headers['x-forwarded-for'] || 'unknown';
    const rateKey = `rate:${ip}`;
    const now     = Date.now();
    const window  = cache.get(rateKey) || { count: 0, start: now };
    if (now - window.start > 60_000) { window.count = 0; window.start = now; }
    window.count++;
    cache.set(rateKey, window);
    if (window.count > 15) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }

    // Check cache
    const cacheKey    = `songs:${mood}`;
    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry && now - cachedEntry.ts < CACHE_TTL) {
        console.log(`Cache hit: ${mood}`);
        return res.status(200).json({ songs: cachedEntry.data, cached: true });
    }

    try {
        const minYear     = mood === 'nostalgic' ? NOSTALGIC_MIN_YEAR : MIN_YEAR;
        const lastfm      = await fetchLastfmTracks(mood);
        const songs       = await enrichWithSpotify(lastfm, minYear);
        const shuffled    = songs.sort(() => Math.random() - 0.5).slice(0, 20);

        // Cache the result
        cache.set(cacheKey, { data: shuffled, ts: now });

        return res.status(200).json({ songs: shuffled, cached: false, count: shuffled.length });
    } catch(err) {
        console.error('API error:', err);
        return res.status(500).json({ error: 'Failed to fetch songs. Please try again.' });
    }
}
