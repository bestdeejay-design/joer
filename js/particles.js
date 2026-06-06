// Floating Particles Controller

// Create floating particles
function createFloatingParticles() {
    // Clear existing particles
    removeParticles();
    
    const particleCount = 50;
    const colors = ['#FF00FF', '#00FFFF', '#FFFF00', '#00FF00', '#FF0000', '#0000FF'];
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'floating-particle';
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.width = Math.random() * 20 + 10 + 'px';
        particle.style.height = particle.style.width;
        particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
        particle.style.position = 'fixed';
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.top = Math.random() * 100 + 'vh';
        particle.style.opacity = Math.random() * 0.5 + 0.2;
        particle.style.zIndex = '-1';
        particle.style.animation = `floatParticle ${Math.random() * 10 + 5}s linear infinite`;
        particle.style.animationDelay = Math.random() * 5 + 's';
        document.body.appendChild(particle);
    }
}

// Remove all floating particles
function removeParticles() {
    document.querySelectorAll('.floating-particle').forEach(p => p.remove());
}

// Initialize particles controller
document.addEventListener('DOMContentLoaded', function() {
    // Particles are controlled by theme switcher, so no initialization needed here
    console.log('Particles controller initialized');
});

// Update particles based on theme
function updateParticles(theme) {
    if (theme === 'party') {
        createFloatingParticles();
    } else {
        removeParticles();
    }
}

// Add event listener for theme changes
window.addEventListener('themechange', function(e) {
    if (e.detail && e.detail.theme) {
        updateParticles(e.detail.theme);
    }
});