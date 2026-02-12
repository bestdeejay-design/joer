// Vinyl Records Animation Controller

// Initialize vinyl record animations
document.addEventListener('DOMContentLoaded', function() {
    initVinylRecordEffects();
});

// Initialize vinyl record related effects
function initVinylRecordEffects() {
    // Add any dynamic effects here if needed
    // Currently the vinyl record animation is handled by CSS
    console.log('Vinyl record effects initialized');
}

// Update vinyl record animation based on theme
function updateVinylRecordAnimation(theme) {
    const vinylRecords = document.querySelectorAll('.vinyl-record');
    
    vinylRecords.forEach(record => {
        if (theme === 'party') {
            // Party mode: faster rotation and bounce effect
            record.style.animation = 'spinVinyl var(--vinyl-speed) infinite linear, vinylBounce 0.5s ease-in-out infinite';
        } else {
            // Lounge mode: slower rotation, no bounce
            record.style.animation = 'spinVinyl var(--vinyl-speed) infinite linear';
        }
    });
}

// Add event listener for theme changes
window.addEventListener('themechange', function(e) {
    if (e.detail && e.detail.theme) {
        updateVinylRecordAnimation(e.detail.theme);
    }
});