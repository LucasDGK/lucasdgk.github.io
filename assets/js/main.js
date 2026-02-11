// ======================
// Language System
// ======================
const translations = {
  es: {},
  en: {},
  de: {}
};

// RSVP Form URLs per language
const formUrls = {
  es: 'https://docs.google.com/forms/d/e/1FAIpQLSdXU6I3s5_Z4DlskwOyluMKuD3UgOl6K_BSp1bng-AWjYIKIA/viewform?embedded=true',
  en: 'https://docs.google.com/forms/d/e/1FAIpQLSeycMmKs7WeDv7D9AmZDrPPUukBdenHfJpFVuXOmO2Z-8QopQ/viewform?embedded=true',
  de: 'https://docs.google.com/forms/d/e/1FAIpQLSe8_IjioJiiBvUWK7NcD7j5HyBRvqQtwUzLlEELbRIU0HJFNw/viewform?embedded=true"'
};

let currentLang = localStorage.getItem('selectedLang') || 'es';

// Initialize language buttons
document.querySelectorAll('.lang-btn').forEach(btn => {
  if (btn.dataset.lang === currentLang) {
    btn.classList.add('active');
  }
  
  btn.addEventListener('click', () => {
    setLanguage(btn.dataset.lang);
  });
});

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('selectedLang', lang);
  
  // Update active button
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.lang === lang) {
      btn.classList.add('active');
    }
  });
  
  // Update all text elements with data-lang attributes
  document.querySelectorAll('[data-' + lang + ']').forEach(element => {
    const value = element.getAttribute('data-' + lang);
    // For buttons with icons, only update the text span
    const textSpan = element.querySelector('.btn-text');
    if (textSpan) {
      textSpan.textContent = value;
    } else if (value.includes('<br>') || value.includes('<sup>')) {
      // Use innerHTML for elements containing HTML tags
      element.innerHTML = value;
    } else {
      element.textContent = value;
    }
  });
  
  // Update RSVP form URL based on language
  const iframe = document.getElementById('rsvp-form');
  if (iframe && formUrls[lang]) {
    iframe.src = formUrls[lang];
  }
}

// Initialize language on page load
setLanguage(currentLang);

// ======================
// Countdown Timer
// ======================
function initCountdown() {
  const targetDate = new Date('2026-06-13T12:00:00+02:00').getTime(); // Spain timezone (UTC+2)
  
  function updateCountdown() {
    const now = new Date().getTime();
    const distance = targetDate - now;
    
    if (distance < 0) {
      document.getElementById('days').textContent = '0';
      document.getElementById('hours').textContent = '0';
      document.getElementById('minutes').textContent = '0';
      document.getElementById('seconds').textContent = '0';
      return;
    }
    
    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    
    document.getElementById('days').textContent = String(days).padStart(2, '0');
    document.getElementById('hours').textContent = String(hours).padStart(2, '0');
    document.getElementById('minutes').textContent = String(minutes).padStart(2, '0');
    document.getElementById('seconds').textContent = String(seconds).padStart(2, '0');
  }
  
  updateCountdown();
  setInterval(updateCountdown, 1000);
}

// ======================
// Calendar Modal
// ======================
function initCalendarModal() {
  const modal = document.getElementById('calendar-modal');
  const addCalendarBtn = document.getElementById('add-to-calendar-btn');
  const closeBtn = document.querySelector('.close');
  const googleCalendarBtn = document.getElementById('google-calendar-btn');
  const appleCalendarBtn = document.getElementById('apple-calendar-btn');
  
  function openModal() {
    modal.style.display = 'block';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  
  function closeModal() {
    modal.style.display = 'none';
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
  
  // Open modal
  addCalendarBtn.addEventListener('click', () => {
    openModal();
  });
  
  // Close modal
  closeBtn.addEventListener('click', () => {
    closeModal();
  });
  
  // Close modal when clicking outside (on the overlay)
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });
  
  // Google Calendar
  googleCalendarBtn.addEventListener('click', () => {
    const eventTitle = 'Boda de Natalia y Lucas';
    const eventStart = '20260613T100000Z'; // 12:00 Spain time (UTC+2) = 10:00 UTC
    const eventEnd = '20260613T220000Z';   // 00:00 Spain time (midnight) = 22:00 UTC
    const eventLocation = 'Parroquia de Santa María de Sábada, Lastres, Asturias, Spain';
    const mapsLink = 'https://maps.app.goo.gl/GMq6KfEfzPXa7sdY6';
    
    const googleCalendarURL = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventTitle)}&dates=${eventStart}/${eventEnd}&location=${encodeURIComponent(eventLocation)}&details=${encodeURIComponent(mapsLink)}`;
    
    window.open(googleCalendarURL, '_blank');
    closeModal();
  });
  
  // Apple Calendar (iCal format)
  appleCalendarBtn.addEventListener('click', () => {
    const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Wedding//Wedding Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VTIMEZONE
TZID:Europe/Madrid
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:natalia-lucas-wedding-2026@nataliaylucas.es
DTSTAMP:20260613T120000
DTSTART;TZID=Europe/Madrid:20260613T120000
DTEND;TZID=Europe/Madrid:20260614T000000
SUMMARY:Boda de Natalia y Lucas
LOCATION:Parroquia de Santa María de Sábada, Lastres, Asturias, Spain
URL:https://maps.app.goo.gl/GMq6KfEfzPXa7sdY6
BEGIN:VALARM
TRIGGER:-PT2H
ACTION:DISPLAY
DESCRIPTION:Recordatorio de la boda
END:VALARM
END:VEVENT
END:VCALENDAR`;
    
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/calendar;charset=utf-8,' + encodeURIComponent(icalContent));
    element.setAttribute('download', 'natalia-lucas-wedding.ics');
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    closeModal();
  });
}

// ======================
// Fade-in on Scroll
// ======================
function initScrollFadeIn() {
  const observerOptions = {
    threshold: 0,
    rootMargin: '0px 0px -50px 0px'
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  
  // Observe all fade-in elements
  document.querySelectorAll('.fade-in').forEach(element => {
    observer.observe(element);
  });
}

// ======================
// iFrame Height
// ======================
function initIFrame() {
  const iframe = document.getElementById('rsvp-form');
  if (iframe) {
    iframe.style.height = '820px';
  }
}

// ======================
// Contact vCard Downloads
// ======================
function initContactDownloads() {
  const nataliaBtn = document.getElementById('contact-natalia');
  const lucasBtn = document.getElementById('contact-lucas');
  
  function downloadVCard(name, phone, filename) {
    const vcard = `BEGIN:VCARD
VERSION:3.0
N:;${name};;;
FN:${name}
TEL;TYPE=CELL:${phone}
END:VCARD`;
    
    const blob = new Blob([vcard], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  
  nataliaBtn.addEventListener('click', (e) => {
    e.preventDefault();
    downloadVCard('Natalia Romero Muñoz', '+34645497122', 'natalia.vcf');
  });
  
  lucasBtn.addEventListener('click', (e) => {
    e.preventDefault();
    downloadVCard('Lucas Delgado González', '+34606873068', 'lucas.vcf');
  });
}

// ======================
// Initialize on Page Load
// ======================
document.addEventListener('DOMContentLoaded', () => {
  initCountdown();
  initCalendarModal();
  initScrollFadeIn();
  initIFrame();
  initContactDownloads();
  
  // Set initial language
  setLanguage(currentLang);
});
