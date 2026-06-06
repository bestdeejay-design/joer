// Radio Stations Database
const radioStations = {
    lounge: [
        { name: "Groove Salad - SomaFM", url: "http://ice2.somafm.com/groovesalad-320-mp3", genre: "chillout", priority: 1 },
        { name: "Groove Salad Classic", url: "https://somafm.com/gsclassic.pls", genre: "ambient", priority: 2 },
        { name: "n5MD Radio", url: "https://somafm.com/n5md.pls", genre: "ambient", priority: 3 },
        { name: "Vaporwaves - SomaFM", url: "https://somafm.com/vaporwaves.pls", genre: "vaporwave", priority: 4 },
        { name: "Secret Agent - SomaFM", url: "http://somafm.com/secretagent.pls", genre: "downtempo", priority: 5 },
        { name: "Lush - SomaFM", url: "http://ice5.somafm.com/lush-128-aac", genre: "dreamy", priority: 6 },
        { name: "Drone Zone - SomaFM", url: "http://ice2.somafm.com/dronezone-256-mp3", genre: "ambient", priority: 7 },
        { name: "Dark Zone - SomaFM", url: "http://ice2.somafm.com/darkzone-256-mp3", genre: "atmospheric", priority: 8 },
        { name: "Illinois Street Lounge", url: "http://somafm.com/illstreet.pls", genre: "lounge", priority: 9 },
        { name: "Radio Paradise - Mellow Mix", url: "http://stream.radioparadise.com/mellow-128", genre: "mellow", priority: 10 },
        { name: "Radio Paradise - Serenity", url: "http://stream.radioparadise.com/serenity", genre: "chill", priority: 11 },
        { name: "Folk Forward - SomaFM", url: "http://somafm.com/folkfwd.pls", genre: "folk", priority: 12 },
        { name: "Synphaera Radio", url: "https://somafm.com/synphaera.pls", genre: "space", priority: 13 },
        { name: "Echoes of Bluemars", url: "http://streams.echoesofbluemars.org:8000/bluemars.m3u", genre: "ambient", priority: 14 },
        { name: "Sonic Universe - SomaFM", url: "http://somafm.com/sonicuniverse.pls", genre: "jazz", priority: 16 }
    ],
    party: [
        { name: "Riverside Radio", url: "https://stream.and-stuff.nl:8443/riverside", genre: "deep house", priority: 1 },
        { name: "Dance Hits - Radio Monster", url: "http://dance.radiomonster.fm/320.mp3", genre: "dance", priority: 2 },
        { name: "Haarlem Shuffle", url: "https://stream.tbmp.nl:8000/haarlemshuffle.flac", genre: "deep house", priority: 3 },
        { name: "Beat Blender - SomaFM", url: "http://somafm.com/startstream=beatblender.pls", genre: "house", priority: 4 },
        { name: "Cliq Hop - SomaFM", url: "http://somafm.com/startstream=cliqhop.pls", genre: "idm", priority: 5 },
        { name: "Top Hits - Radio Monster", url: "http://tophits.radiomonster.fm/320.mp3", genre: "pop", priority: 6 },
        { name: "Dub Step Beyond - SomaFM", url: "http://somafm.com/dubstep.pls", genre: "dubstep", priority: 7 },
        { name: "Scenesat", url: "http://oscar.scenesat.com:8000/scenesatmax", genre: "electronic", priority: 8 },
        { name: "Electronic Culture", url: "http://www.shouted.fm/tunein/electro-dsl.m3u", genre: "electronic", priority: 9 },
        { name: "Indie Pop Rocks! - SomaFM", url: "http://somafm.com/indiepop130.pls", genre: "indie", priority: 10 },
        { name: "PopTron! - SomaFM", url: "http://somafm.com/poptron.pls", genre: "pop", priority: 11 },
        { name: "Tags Trance Trip - SomaFM", url: "http://somafm.com/tagstrance.pls", genre: "trance", priority: 12 },
        { name: "Joyhits", url: "http://joyhits.online/joyhits.flac.ogg", genre: "dance", priority: 13 },
        { name: "Radio Paradise - Main Mix", url: "http://stream.radioparadise.com/aac-128", genre: "eclectic", priority: 14 },
        { name: "Frequence 3 - Paris", url: "http://streams.frequence3.net/hd-mp3.m3u", genre: "pop/rock", priority: 15 },
        { name: "Hot 97 NYC", url: "http://playerservices.streamtheworld.com/pls/WQHTAAC.pls", genre: "hip hop", priority: 16 },
        { name: "Power 1051 NYC", url: "http://c11.prod.playlists.ihrhls.com/1481/playlist.m3u8", genre: "hip hop", priority: 17 },
        { name: "The Trip - SomaFM", url: "https://somafm.com/thetrip.pls", genre: "electronic", priority: 18 },
        { name: "Metal Detector - SomaFM", url: "https://somafm.com/metal.pls", genre: "metal", priority: 19 },
        { name: "Beyond Metal", url: "http://streamingV2.shoutcast.com/BeyondMetal", genre: "metal", priority: 20 },
        { name: "DanceUK", url: "http://uk2.internet-radio.com:8024/listen.pls", genre: "dance", priority: 21 }
    ]
};

// Global variables
let audio = new Audio();
let currentStation = null;
let isPlaying = false;
let isMuted = false;
let currentTheme = 'lounge';
let visualizerInterval = null;
let retryCount = 0;
let maxRetries = 5;

// Initialize player
function initRadioPlayer() {
    // Load station buttons
    loadStationButtons();
    
    // Set up event listeners
    setupEventListeners();
    
    // Check if audio is allowed
    const audioAllowed = localStorage.getItem('audioAllowed') === 'true';
    
    if (audioAllowed) {
        // Auto-play lounge station on load
        playStation(radioStations.lounge[0]);
    } else {
        // Show permission button
        showAudioPermissionButton();
    }
    
    // Start visualizer animation
    startVisualizer();
}

// Load station buttons into dropdown
function loadStationButtons() {
    const loungeContainer = document.querySelector('.lounge-stations');
    const partyContainer = document.querySelector('.party-stations');
    
    if (!loungeContainer || !partyContainer) {
        console.error('Station containers not found');
        return;
    }
    
    // Lounge stations
    radioStations.lounge.forEach(station => {
        const btn = document.createElement('button');
        btn.className = 'station-btn';
        btn.textContent = station.name;
        btn.dataset.url = station.url;
        btn.dataset.genre = station.genre;
        btn.addEventListener('click', () => playStation(station));
        loungeContainer.appendChild(btn);
    });
    
    // Party stations
    radioStations.party.forEach(station => {
        const btn = document.createElement('button');
        btn.className = 'station-btn';
        btn.textContent = station.name;
        btn.dataset.url = station.url;
        btn.dataset.genre = station.genre;
        btn.addEventListener('click', () => playStation(station));
        partyContainer.appendChild(btn);
    });
}

// Play station
function playStation(station) {
    // Stop current audio
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
        updatePlayButton(false);
    }
    
    // Update UI
    const stationNameEl = document.querySelector('.station-name');
    const stationGenreEl = document.querySelector('.station-genre');
    
    if (stationNameEl) stationNameEl.textContent = station.name;
    if (stationGenreEl) stationGenreEl.textContent = station.genre.toUpperCase();
    
    // Remove active class from all buttons
    document.querySelectorAll('.station-btn').forEach(btn => btn.classList.remove('active'));
    
    // Add active class to clicked button
    const clickedBtn = Array.from(document.querySelectorAll('.station-btn')).find(btn => btn.dataset.url === station.url);
    if (clickedBtn) clickedBtn.classList.add('active');
    
    // Set new station
    currentStation = station;
    
    // Reset retry count
    retryCount = 0;
    
    // Try to play
    tryPlayStation(station.url);
}

// Try to play station with fallback
function tryPlayStation(url, retryCount = 0) {
    console.log('Trying to play:', url);
    
    audio.src = url;
    
    // Set up error handler
    const errorHandler = () => {
        console.error('Station failed:', url);
        audio.removeEventListener('error', errorHandler);
        audio.removeEventListener('canplay', successHandler);
        
        // Try next station in same category
        if (retryCount < maxRetries) {
            const category = currentTheme === 'party' ? 'party' : 'lounge';
            const currentIndex = radioStations[category].findIndex(s => s.url === url);
            const nextIndex = (currentIndex + 1) % radioStations[category].length;
            const nextStation = radioStations[category][nextIndex];
            
            console.log('Trying next station:', nextStation.name);
            playStation(nextStation);
        } else {
            showError('All stations are currently unavailable. Please try again later.');
        }
    };
    
    // Set up success handler
    const successHandler = () => {
        console.log('Station loaded successfully:', url);
        audio.removeEventListener('error', errorHandler);
        audio.removeEventListener('canplay', successHandler);
        
        // Play audio
        audio.play().then(() => {
            isPlaying = true;
            console.log('Audio playing');
            updatePlayButton(true);
            
            // Remember audio permission
            localStorage.setItem('audioAllowed', 'true');
            
            // Remove permission button if exists
            const permBtn = document.querySelector('.audio-permission-btn');
            if (permBtn) permBtn.remove();
            
        }).catch((error) => {
            console.error('Playback failed:', error);
            showAudioPermissionButton();
        });
    };
    
    // Add listeners
    audio.addEventListener('error', errorHandler);
    audio.addEventListener('canplay', successHandler);
    
    // Load audio
    audio.load();
}

// Toggle play/pause
function togglePlayPause() {
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
        updatePlayButton(false);
    } else if (currentStation) {
        audio.play().then(() => {
            isPlaying = true;
            updatePlayButton(true);
        }).catch((error) => {
            console.error('Play failed:', error);
            showAudioPermissionButton();
        });
    }
}

// Update play button icon
function updatePlayButton(isPlaying) {
    const btn = document.querySelector('.play-pause-btn');
    if (btn) {
        btn.innerHTML = isPlaying ? '⏸️' : '▶️';
    }
}

// Toggle mute
function toggleMute() {
    isMuted = !isMuted;
    audio.muted = isMuted;
    
    const muteBtn = document.querySelector('.mute-btn');
    if (muteBtn) {
        muteBtn.innerHTML = isMuted ? '🔇' : '🔊';
        muteBtn.classList.toggle('muted', isMuted);
    }
}

// Update volume
function updateVolume(value) {
    audio.volume = value / 100;
}

// Show audio permission button
function showAudioPermissionButton() {
    // Remove existing button
    const existing = document.querySelector('.audio-permission-btn');
    if (existing) existing.remove();
    
    const permissionBtn = document.createElement('div');
    permissionBtn.className = 'audio-permission-btn';
    permissionBtn.innerHTML = `
        <button class="btn-neon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3z" stroke="currentColor" stroke-width="2"/>
                <path d="M9 10H7a5 5 0 0 1-3.54-8.54L7 5h2" stroke="currentColor" stroke-width="2"/>
                <path d="M15 10h2a5 5 0 0 1 3.54-8.54L17 5h-2" stroke="currentColor" stroke-width="2"/>
                <path d="M9 22v-4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4" stroke="currentColor" stroke-width="2"/>
                <path d="M9 18h6" stroke="currentColor" stroke-width="2"/>
            </svg>
            Enable Music
        </button>
    `;
    permissionBtn.style.position = 'fixed';
    permissionBtn.style.bottom = '100px';
    permissionBtn.style.left = '50%';
    permissionBtn.style.transform = 'translateX(-50%)';
    permissionBtn.style.zIndex = '10000';
    permissionBtn.style.animation = 'pulse 2s infinite';
    
    permissionBtn.querySelector('button').addEventListener('click', () => {
        if (currentStation) {
            audio.play().then(() => {
                isPlaying = true;
                localStorage.setItem('audioAllowed', 'true');
                permissionBtn.remove();
                updatePlayButton(true);
            }).catch((error) => {
                console.error('Audio permission denied:', error);
                alert('Please allow audio playback in your browser settings.');
            });
        } else {
            // Play default lounge station
            playStation(radioStations.lounge[0]);
        }
    });
    
    document.body.appendChild(permissionBtn);
}

// Start visualizer animation
function startVisualizer() {
    clearInterval(visualizerInterval);
    
    visualizerInterval = setInterval(() => {
        const bars = document.querySelectorAll('.visualizer-bar');
        bars.forEach(bar => {
            // Random height between 5px and 40px
            const height = Math.floor(Math.random() * 35) + 5;
            bar.style.height = height + 'px';
        });
    }, 100);
}

// Stop visualizer
function stopVisualizer() {
    clearInterval(visualizerInterval);
}

// Show error message
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.style.position = 'fixed';
    errorDiv.style.bottom = '100px';
    errorDiv.style.left = '50%';
    errorDiv.style.transform = 'translateX(-50%)';
    errorDiv.style.background = 'rgba(255, 0, 0, 0.9)';
    errorDiv.style.color = 'white';
    errorDiv.style.padding = '12px 24px';
    errorDiv.style.borderRadius = '8px';
    errorDiv.style.zIndex = '10000';
    errorDiv.style.boxShadow = '0 4px 20px rgba(255, 0, 0, 0.5)';
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => errorDiv.remove(), 5000);
}

// Setup event listeners
function setupEventListeners() {
    // Play/Pause button
    const playPauseBtn = document.querySelector('.play-pause-btn');
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', togglePlayPause);
    }
    
    // Mute button
    const muteBtn = document.querySelector('.mute-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMute);
    }
    
    // Volume slider
    const volumeSlider = document.querySelector('.volume-slider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            updateVolume(e.target.value);
        });
    }
    
    // Station selector
    const selectorBtn = document.querySelector('.selector-btn');
    const stationDropdown = document.querySelector('.station-dropdown');
    
    if (selectorBtn && stationDropdown) {
        selectorBtn.addEventListener('click', () => {
            stationDropdown.classList.toggle('active');
        });
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.querySelector('.station-dropdown');
        const selector = document.querySelector('.selector-btn');
        
        if (dropdown && selector) {
            if (dropdown.classList.contains('active') && 
                !dropdown.contains(e.target) && 
                !selector.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        }
    });
}

// Theme change handler
function onThemeChange(newTheme) {
    currentTheme = newTheme;
    
    // Stop current audio
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
        updatePlayButton(false);
    }
    
    // Select first station from new theme category
    const stations = radioStations[newTheme === 'party' ? 'party' : 'lounge'];
    if (stations.length > 0) {
        playStation(stations[0]);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initRadioPlayer);

// Export function for theme switcher integration
window.onThemeChange = onThemeChange;