// Loader with fade-out
window.addEventListener("load", () => {
    const l = document.getElementById("loader");
    if (l) {
        l.classList.add('hidden');
        setTimeout(() => l.remove(), 800);
    }
});

// Staggered reveal for elements with .fade-in
const faders = document.querySelectorAll('.fade-in');
faders.forEach((el, i) => {
    el.style.setProperty('--delay', `${i * 0.12}s`);
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('show');
    });
}, {threshold: 0.18});

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
window.addEventListener('scroll', () => {
    const top = window.scrollY + 120;
    let current = sections[0];
    for (const s of sections) if (s.offsetTop <= top) current = s;
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${current.id}`));
});

// EmailJS initialization and contact form handler
(function(){
    if (window.emailjs) {
        emailjs.init('4mFlwg7HJxXVy7rrv');
    } else {
        console.warn('EmailJS SDK not loaded.');
    }
})();

const contactForm = document.getElementById('contact-form');
if (contactForm) {
    contactForm.addEventListener('submit', function(e){
        e.preventDefault();
        const statusEl = document.getElementById('form-status');
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        if (statusEl) statusEl.textContent = 'Sending…';

        emailjs.sendForm('service_9ookyda', 'template_5uvzm4q', this, '4mFlwg7HJxXVy7rrv')
            .then(() => {
                if (statusEl) statusEl.textContent = 'Message sent — thank you!';
                contactForm.reset();
                if (submitBtn) submitBtn.disabled = false;
            }, (err) => {
                console.error('EmailJS error', err);
                if (statusEl) statusEl.textContent = 'Sending failed. Please try again later.';
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