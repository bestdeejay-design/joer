// Disco Ball Animation Controller

// Initialize disco ball animation
document.addEventListener('DOMContentLoaded', function() {
    // The disco ball animation is handled by CSS, but we might want to add some dynamic effects
    initDiscoBallEffects();
});

// Initialize disco ball related effects
function initDiscoBallEffects() {
    // Add any dynamic effects here if needed
    // Currently the disco ball animation is handled by CSS
    console.log('Disco ball effects initialized');
}

// Update disco ball animation based on theme
function updateDiscoBallAnimation(theme) {
    const discoBall = document.querySelector('.disco-ball');
    if (discoBall) {
        if (theme === 'party') {
            // Party mode: faster rotation
            discoBall.style.animationDuration = '3s';
        } else {
            // Lounge mode: slower rotation
            discoBall.style.animationDuration = '10s';
        }
    }
    
    // Update light beams for theme
    updateLightBeams(theme);
}

// Update light beams based on theme
function updateLightBeams(theme) {
    const beams = document.querySelectorAll('.beam');
    if (beams.length > 0) {
        if (theme === 'party') {
            // Party mode: more intense beams
            beams.forEach(beam => {
                beam.style.opacity = '0.7';
                beam.style.filter = 'blur(4px)';
            });
        } else {
            // Lounge mode: softer beams
            beams.forEach(beam => {
                beam.style.opacity = '0.3';
                beam.style.filter = 'blur(2px)';
            });
        }
    }
}

// Add event listener for theme changes
window.addEventListener('themechange', function(e) {
    if (e.detail && e.detail.theme) {
        updateDiscoBallAnimation(e.detail.theme);
    }
});