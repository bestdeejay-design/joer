// Main JavaScript file for After Dark website

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('After Dark website loaded');
    
    // Initialize scroll reveal animations
    initScrollReveal();
    
    // Initialize navigation
    initNavigation();
    
    // Initialize mobile menu
    initMobileMenu();
});

// Initialize scroll reveal animations
function initScrollReveal() {
    // Elements to animate when they come into view
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);
    
    // Observe elements with scroll-reveal class
    document.querySelectorAll('.scroll-reveal').forEach(el => {
        observer.observe(el);
    });
    
    // Add scroll-reveal class to some elements that should animate
    document.querySelectorAll('h2, .feature-card, .mode-card, .btn-primary, .btn-secondary').forEach(el => {
        el.classList.add('scroll-reveal');
    });
}

// Initialize navigation
function initNavigation() {
    // Add active class to nav links when scrolling to sections
    window.addEventListener('scroll', function() {
        const sections = document.querySelectorAll('section');
        const navLinks = document.querySelectorAll('.nav-link');
        
        let current = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            
            if (pageYOffset >= (sectionTop - sectionHeight / 3)) {
                current = section.getAttribute('id');
            }
        });
        
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80, // Account for fixed elements
                    behavior: 'smooth'
                });
                
                // Close mobile menu if open
                const mobileMenu = document.getElementById('mobileMenu');
                const mobileToggle = document.getElementById('mobileMenuToggle');
                
                if (mobileMenu.classList.contains('active')) {
                    mobileMenu.classList.remove('active');
                    mobileToggle.classList.remove('active');
                }
            }
        });
    });
}

// Initialize mobile menu
function initMobileMenu() {
    const mobileToggle = document.getElementById('mobileMenuToggle');
    const mobileMenu = document.getElementById('mobileMenu');
    
    if (mobileToggle && mobileMenu) {
        mobileToggle.addEventListener('click', function() {
            mobileToggle.classList.toggle('active');
            mobileMenu.classList.toggle('active');
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', function(e) {
            if (!mobileMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
                mobileMenu.classList.remove('active');
                mobileToggle.classList.remove('active');
            }
        });
    }
}

// Utility function to scroll to section
function scrollToSection(sectionId) {
    const element = document.querySelector(sectionId);
    if (element) {
        element.scrollIntoView({ 
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// Utility function to get current theme
function getCurrentTheme() {
    return document.body.getAttribute('data-theme') || 'lounge';
}

// Utility function to set theme
function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    
    // Update theme label
    const themeLabel = document.querySelector('.theme-label');
    if (themeLabel) {
        themeLabel.textContent = theme === 'party' ? 'PARTY' : 'LOUNGE';
    }
    
    // Update theme icon if needed
    const themeIcon = document.querySelector('.theme-icon');
    if (themeIcon) {
        themeIcon.textContent = theme === 'party' ? '🎉' : '🎛️';
    }
    
    // Trigger theme change event for other components
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

// Add keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + T to toggle theme
    if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        const currentTheme = getCurrentTheme();
        setTheme(currentTheme === 'lounge' ? 'party' : 'lounge');
    }
});