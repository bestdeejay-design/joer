// Theme Switcher functionality

// Initialize theme switcher
document.addEventListener('DOMContentLoaded', function() {
    const themeSwitcher = document.getElementById('themeSwitcher');
    
    if (themeSwitcher) {
        themeSwitcher.addEventListener('click', toggleTheme);
    }
    
    // Check for saved theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        document.body.setAttribute('data-theme', savedTheme);
        updateThemeDisplay(savedTheme);
    }
    
    // Listen for theme change events from other components
    window.addEventListener('themechange', function(e) {
        if (e.detail && e.detail.theme) {
            updateThemeDisplay(e.detail.theme);
        }
    });
});

// Toggle between lounge and party themes
function toggleTheme() {
    const currentTheme = document.body.getAttribute('data-theme') || 'lounge';
    const newTheme = currentTheme === 'lounge' ? 'party' : 'lounge';
    
    setTheme(newTheme);
    
    // Trigger confetti effect when switching to party mode
    if (newTheme === 'party') {
        createConfettiEffect();
    }
    
    // Update strobe effect based on theme
    updateStrobeEffect(newTheme);
    
    // Update floating particles based on theme
    updateParticles(newTheme);
    
    // Notify other components about theme change
    if (typeof window.onThemeChange === 'function') {
        window.onThemeChange(newTheme);
    }
    
    // Save preference
    localStorage.setItem('theme', newTheme);
}

// Set theme and update UI
function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    updateThemeDisplay(theme);
    
    // Update theme label
    const themeLabel = document.querySelector('.theme-label');
    if (themeLabel) {
        themeLabel.textContent = theme === 'party' ? 'PARTY' : 'LOUNGE';
    }
    
    // Update theme icon
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
        themeIcon.textContent = theme === 'party' ? '🎉' : '🎛️';
    }
}

// Update theme display elements
function updateThemeDisplay(theme) {
    const themeSwitcher = document.getElementById('themeSwitcher');
    
    if (themeSwitcher) {
        // Apply theme-specific styles to switcher
        if (theme === 'party') {
            themeSwitcher.style.borderColor = 'var(--accent-pink)';
            themeSwitcher.style.boxShadow = '0 0 20px var(--accent-pink)';
        } else {
            themeSwitcher.style.borderColor = 'var(--accent-neon)';
            themeSwitcher.style.boxShadow = '0 0 20px var(--accent-neon)';
        }
    }
}

// Create confetti effect
function createConfettiEffect() {
    const colors = ['#FF00FF', '#00FFFF', '#FFFF00', '#00FF00', '#FF0000', '#0000FF'];
    const container = document.body;
    
    for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.width = Math.random() * 10 + 5 + 'px';
        confetti.style.height = Math.random() * 10 + 5 + 'px';
        confetti.style.animationDuration = Math.random() * 3 + 2 + 's';
        
        container.appendChild(confetti);
        
        // Remove confetti after animation completes
        setTimeout(() => {
            confetti.remove();
        }, 5000);
    }
}

// Update strobe effect based on theme
function updateStrobeEffect(theme) {
    if (theme === 'party') {
        document.body.classList.add('strobe-active');
    } else {
        document.body.classList.remove('strobe-active');
    }
}

// Update floating particles based on theme
function updateParticles(theme) {
    if (theme === 'party') {
        createFloatingParticles();
    } else {
        removeParticles();
    }
}

// Get current theme
function getCurrentTheme() {
    return document.body.getAttribute('data-theme') || 'lounge';
}

// Initialize theme-dependent features
function initThemeFeatures() {
    const currentTheme = getCurrentTheme();
    
    if (currentTheme === 'party') {
        updateStrobeEffect('party');
        createFloatingParticles();
    } else {
        updateStrobeEffect('lounge');
        removeParticles();
    }
}

// Run initialization when DOM is loaded
document.addEventListener('DOMContentLoaded', initThemeFeatures);