// Strobe Light Effect Controller

// Initialize strobe effect controller
document.addEventListener('DOMContentLoaded', function() {
    // Strobe effect is controlled by theme switcher, so no initialization needed here
    console.log('Strobe effect controller initialized');
});

// Update strobe effect based on theme
function updateStrobeEffect(theme) {
    const body = document.body;
    
    if (theme === 'party') {
        body.classList.add('strobe-active');
    } else {
        body.classList.remove('strobe-active');
    }
}

// Add event listener for theme changes
window.addEventListener('themechange', function(e) {
    if (e.detail && e.detail.theme) {
        updateStrobeEffect(e.detail.theme);
    }
});

// Function to temporarily activate strobe effect (for special occasions)
function activateStrobe(moment = false) {
    const body = document.body;
    body.classList.add('strobe-active');
    
    if (moment) {
        // Remove after a short time if it's just a momentary flash
        setTimeout(() => {
            // Only remove if party mode is not active
            if (body.getAttribute('data-theme') !== 'party') {
                body.classList.remove('strobe-active');
            }
        }, 1000);
    }
}

// Function to deactivate strobe effect
function deactivateStrobe() {
    document.body.classList.remove('strobe-active');
}