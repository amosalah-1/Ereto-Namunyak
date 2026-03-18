// Loader with fade-out
window.addEventListener("load", () => {
    const l = document.getElementById("loader");
    if (l) {
        l.classList.add('hidden');
        setTimeout(() => l.remove(), 800);
    }
});

// Fail-safe: Remove loader after 5s if window load event hangs
setTimeout(() => {
    const l = document.getElementById("loader");
    if (l && !l.classList.contains('hidden')) {
        l.classList.add('hidden');
        setTimeout(() => l.remove(), 800);
    }
}, 5000);

// Staggered reveal for elements with .fade-in
const faders = document.querySelectorAll('.fade-in');
faders.forEach((el, i) => {
    el.style.setProperty('--delay', `${i * 0.12}s`);
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('show');
    });
}, {threshold: 0.05});

faders.forEach(f => observer.observe(f));

// Simple typed text for hero tagline
const typedEl = document.getElementById('typed');
if (typedEl) {
    const words = ['Diligence', 'Unity', 'Service', 'Hope'];
    let i = 0, j = 0, forward = true;
    function tick() {
        const word = words[i];
        typedEl.textContent = word.slice(0, j);
        if (forward) {
            if (j++ === word.length) { forward = false; setTimeout(tick, 900); return }
        } else {
            if (j-- === 0) { forward = true; i = (i+1) % words.length; setTimeout(tick, 160); return }
        }
        setTimeout(tick, forward ? 120 : 60);
    }
    tick();
}

// Nav link active state on scroll
const sections = Array.from(document.querySelectorAll('section[id]'));
const navLinks = Array.from(document.querySelectorAll('nav a'));
let isScrolling = false;

window.addEventListener('scroll', () => {
    if (!isScrolling) {
        window.requestAnimationFrame(() => {
            const top = window.scrollY + 120;
            let current = sections[0];
            for (const s of sections) if (s.offsetTop <= top) current = s;
            navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${current.id}`));
            isScrolling = false;
        });
        isScrolling = true;
    }
});

// Contact Form Handler (Connected to Backend)
const contactForm = document.getElementById('contact-form');
if (contactForm) {
    contactForm.addEventListener('submit', function(e){
        e.preventDefault();
        
        const statusEl = document.getElementById('form-status');
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        
        if (submitBtn) submitBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Sending…';

        // Collect form data
        const formData = new FormData(this);
        const data = Object.fromEntries(formData.entries());

        // Send to Backend API
        fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                if (statusEl) statusEl.textContent = 'Message sent — thank you!';
                contactForm.reset();
            } else {
                throw new Error(result.message);
            }
        })
        .catch(err => {
            console.error('Contact Form Error:', err);
            if (statusEl) statusEl.textContent = 'Sending failed. Please try again later.';
        })
        .finally(() => {
            if (submitBtn) submitBtn.disabled = false;
        });
    });
}

// Stats Counter Animation
const statsSection = document.getElementById('impact');
const stats = document.querySelectorAll('.stat-number');
let statsStarted = false;

if (statsSection && stats.length > 0) {
    const statsObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !statsStarted) {
            stats.forEach(stat => {
                const target = +stat.getAttribute('data-target');
                const duration = 1500; 
                const increment = target / (duration / 16);
                let current = 0;
                const update = () => {
                    current += increment;
                    if (current < target) {
                        stat.textContent = Math.ceil(current);
                        requestAnimationFrame(update);
                    } else {
                        stat.textContent = target + "+";
                    }
                };
                update();
            });
            statsStarted = true;
        }
    }, { threshold: 0.5 });
    statsObserver.observe(statsSection);
}

// Dynamic Year
const yearSpan = document.getElementById('year');
if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
}

// Mobile Menu Toggle
const menuToggle = document.querySelector('.mobile-menu-toggle');
const navLinksContainer = document.querySelector('.nav-links');

if (menuToggle && navLinksContainer) {
    menuToggle.addEventListener('click', () => {
        const isExpanded = navLinksContainer.classList.contains('active');
        menuToggle.setAttribute('aria-expanded', !isExpanded);
        navLinksContainer.classList.toggle('active');
    });
}

// Back to Top Button
const backToTopBtn = document.getElementById('backToTop');
if (backToTopBtn) {
    window.addEventListener('scroll', () => {
        // Show button after scrolling down 400px
        if (window.scrollY > 400) {
            backToTopBtn.classList.add('show');
        } else {
            backToTopBtn.classList.remove('show');
        }
    });

    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// Donation Modal Interaction
const donateBtn = document.getElementById('donate-btn-open');
const donationModal = document.getElementById('donation-modal');
const closeDonationModal = document.querySelector('.modal-close');

if (donateBtn && donationModal && closeDonationModal) {
    donateBtn.addEventListener('click', () => {
        donationModal.classList.add('show');
    });
    closeDonationModal.addEventListener('click', () => {
        donationModal.classList.remove('show');
    });
    donationModal.addEventListener('click', (e) => {
        if (e.target === donationModal) donationModal.classList.remove('show');
    });
}

// Donation Form Handler
const donationForm = document.getElementById('donation-form');

if (donationForm) {
    donationForm.addEventListener('submit', (e) => {
        e.preventDefault(); // Prevent actual form submission (page reload)

        const amountInput = document.getElementById('donation-amount');
        const nameInput = document.getElementById('donation-name');
        const phoneInput = document.getElementById('donation-phone');
        const statusDiv = document.getElementById('donation-status');
        const submitBtn = donationForm.querySelector('.btn-submit-donation');
        
        const amount = amountInput.value;
        const name = nameInput ? nameInput.value : 'Anonymous';
        const phone = phoneInput ? phoneInput.value : '';

        // Simple validation
        if (!amount || amount < 50) {
            if (statusDiv) {
                statusDiv.textContent = "Please enter a valid amount (minimum 50 KES).";
                statusDiv.style.color = "red";
            }
            return;
        }

        // Show processing state
        if (submitBtn) submitBtn.disabled = true;
        if (submitBtn) submitBtn.textContent = "Processing...";
        if (statusDiv) statusDiv.textContent = "Initiating payment gateway...";
        if (statusDiv) statusDiv.style.color = "inherit";

        // This function sends the donation data to your backend server.
        // The backend will then securely communicate with Pesapal.
        // You must create this '/api/create-payment' endpoint on your server.
        fetch('/api/create-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ amount: amount, name: name, phone: phone }),
        })
        .then(async response => {
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Payment initiation failed.');
            }
            return response.json();
        })
        .then(data => {
            if (data && data.redirect_url) {
                // If we get a redirect URL from the backend, send the user to Pesapal
                window.location.href = data.redirect_url;
            } else {
                throw new Error('Could not retrieve payment link from the server.');
            }
        })
        .catch(error => {
            console.error('Payment Error:', error);
            if (statusDiv) {
                statusDiv.textContent = error.message || 'An unexpected error occurred.';
                statusDiv.style.color = "red";
            }
            // Re-enable the button so the user can try again
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Proceed to Pesapal";
            }
        });
    });
}

// Check for successful payment on page load (returning from Pesapal)
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('status') === 'success') {
        alert("Thank you! Your donation was initiated successfully.");
        // Optional: clear the query parameter from the URL bar
        window.history.replaceState({}, document.title, window.location.pathname);
    }
});