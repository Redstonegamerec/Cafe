/* ========================================
   THE NOOK CAFÉ — Main Application JS
   ======================================== */

document.addEventListener('DOMContentLoaded', async () => {
  // ---- Navbar Scroll ----
  const navbar = document.getElementById('navbar');
  if (navbar && !navbar.classList.contains('navbar-light')) {
    const handleScroll = () => {
      if (window.scrollY > 60) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }

  // ---- Mobile Menu ----
  const hamburger = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileOverlay = document.getElementById('mobile-overlay');
  const mobileClose = document.getElementById('mobile-close');

  const openMenu = () => {
    mobileMenu?.classList.add('open');
    mobileOverlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  const closeMenu = () => {
    mobileMenu?.classList.remove('open');
    mobileOverlay?.classList.remove('open');
    document.body.style.overflow = '';
  };

  hamburger?.addEventListener('click', openMenu);
  mobileClose?.addEventListener('click', closeMenu);
  mobileOverlay?.addEventListener('click', closeMenu);

  // Close on link click
  mobileMenu?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // ---- Intersection Observer for Animations ----
  const observerOptions = {
    threshold: 0.15,
    rootMargin: '0px 0px -40px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.fade-in, .slide-up').forEach(el => {
    observer.observe(el);
  });

  // ---- Time Slots Data ----
  let timeSlots = [];
  try {
    const res = await fetch('/api/slots');
    if (res.ok) timeSlots = await res.json();
  } catch (e) {
    console.error('Failed to load slots from backend', e);
  }

  // Live Updates Socket
  let socket = null;
  if (typeof io !== 'undefined') {
    socket = io();
    socket.on('slots-updated', async () => {
      try {
        const res = await fetch('/api/slots');
        if (res.ok) {
          timeSlots = await res.json();
          // Re-render components
          const homeContainer = document.getElementById('slots-scroll');
          if (homeContainer) renderHomeSlots(homeContainer);

          const stripScroll = document.getElementById('strip-time-scroll');
          if (stripScroll) window.renderQuickBookingStrip(stripScroll, window.stripSelectedTime);

          const timeChipsContainer = document.getElementById('time-chips');
          if (timeChipsContainer) {
            const selEl = timeChipsContainer.querySelector('.time-chip.selected');
            const preselectTime = selEl ? selEl.dataset.time : null;
            if (window.renderTimeChipsFn) window.renderTimeChipsFn(preselectTime);
          }
        }
      } catch (e) {}
    });
  }

  // ---- Render Home Page Slots ----
  const slotsContainer = document.getElementById('slots-scroll');
  if (slotsContainer) {
    renderHomeSlots(slotsContainer);
  }

  function renderHomeSlots(container) {
    container.innerHTML = timeSlots.map(slot => {
      const statusText = {
        'available': 'Available',
        'filling-fast': 'Filling Fast',
        'full': 'Full'
      };

      return `
        <div class="slot-card ${slot.status}" ${slot.status !== 'full' ? `onclick="window.location.href='booking.html?time=${encodeURIComponent(slot.time)}'"` : ''}>
          <div class="slot-time">${slot.time}</div>
          <div class="slot-period">${slot.period}</div>
          <div class="slot-status ${slot.status}">
            <span class="dot"></span>
            ${statusText[slot.status]}
          </div>
          ${slot.seats > 0 ? `<div class="slot-seats">${slot.seats} seats left</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // ---- Quick Booking Strip Logic ----
  const quickBookingForm = document.getElementById('quick-booking-form');
  if (quickBookingForm) {
    const stripDateInput = document.getElementById('strip-date');
    const stripTimeScroll = document.getElementById('strip-time-scroll');
    const stripStepperMinus = document.getElementById('strip-stepper-minus');
    const stripStepperPlus = document.getElementById('strip-stepper-plus');
    const stripStepperValue = document.getElementById('strip-stepper-value');
    const stripBtnCheck = document.getElementById('strip-btn-check');

    let stripSelectedTime = null;
    let stripGuestCount = 2;

    // Set min date to today
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    stripDateInput.min = `${yyyy}-${mm}-${dd}`;
    stripDateInput.value = `${yyyy}-${mm}-${dd}`;
    
    // Render time chips
    window.renderQuickBookingStrip = function(container, preselectedTime = null) {
        container.innerHTML = timeSlots.map(slot => {
            const isDisabled = slot.status === 'full';
            const isFew = slot.status === 'filling-fast';
            const isSelected = preselectedTime === slot.time;
            let classes = 'time-chip';
            if (isDisabled) classes += ' disabled';
            if (isFew && !isSelected) classes += ' few-left';
            if (isSelected) classes += ' selected';
            
            return `<button type="button" class="${classes}" data-time="${slot.time}" ${isDisabled ? 'disabled' : ''}>${slot.time}</button>`;
        }).join('');

        const stripChips = container.querySelectorAll('.time-chip:not(.disabled)');
        stripChips.forEach(chip => {
            chip.addEventListener('click', () => {
                stripChips.forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
                window.stripSelectedTime = chip.dataset.time;
                stripSelectedTime = chip.dataset.time;
            });
        });
    };
    
    window.stripSelectedTime = stripSelectedTime;
    window.renderQuickBookingStrip(stripTimeScroll, stripSelectedTime);

    stripStepperMinus?.addEventListener('click', () => {
        if (stripGuestCount > 1) {
            stripGuestCount--;
            stripStepperValue.textContent = stripGuestCount;
            stripStepperValue.style.transform = 'scale(1.2)';
            setTimeout(() => stripStepperValue.style.transform = 'scale(1)', 200);
        }
    });

    stripStepperPlus?.addEventListener('click', () => {
        if (stripGuestCount < 12) {
            stripGuestCount++;
            stripStepperValue.textContent = stripGuestCount;
            stripStepperValue.style.transform = 'scale(1.2)';
            setTimeout(() => stripStepperValue.style.transform = 'scale(1)', 200);
        }
    });

    stripBtnCheck?.addEventListener('click', () => {
        let qs = `?date=${stripDateInput.value}&guests=${stripGuestCount}`;
        if (stripSelectedTime) qs += `&time=${encodeURIComponent(stripSelectedTime)}`;
        window.location.href = `booking.html${qs}`;
    });
  }

  // ---- Booking Page Logic ----
  const timeChips = document.getElementById('time-chips');
  if (timeChips) {
    initBookingPage();
  }

  function initBookingPage() {
    let selectedTime = null;
    let guestCount = 2;

    // Set min date to today
    const dateInput = document.getElementById('booking-date');
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateInput.min = `${yyyy}-${mm}-${dd}`;
    dateInput.value = `${yyyy}-${mm}-${dd}`;

    // Check URL for pre-selected options
    const urlParams = new URLSearchParams(window.location.search);
    const preselectedTime = urlParams.get('time');
    const preselectedDate = urlParams.get('date');
    const preselectedGuests = urlParams.get('guests');

    if (preselectedDate) {
      dateInput.value = preselectedDate;
    }
    
    if (preselectedGuests) {
      guestCount = parseInt(preselectedGuests);
      const sVal = document.getElementById('stepper-value');
      if (sVal) sVal.textContent = guestCount;
    }

    // Render time chips
    window.renderTimeChipsFn = renderTimeChips;
    renderTimeChips(preselectedTime);

    function renderTimeChips(preselect = null) {
      const container = document.getElementById('time-chips');
      container.innerHTML = timeSlots.map(slot => {
        const isDisabled = slot.status === 'full';
        const isFew = slot.status === 'filling-fast';
        const isSelected = preselect === slot.time;

        if (isSelected) selectedTime = slot.time;

        let classes = 'time-chip';
        if (isDisabled) classes += ' disabled';
        if (isFew && !isSelected) classes += ' few-left';
        if (isSelected) classes += ' selected';

        return `
          <button type="button" class="${classes}"
            data-time="${slot.time}" data-seats="${slot.seats}" data-status="${slot.status}"
            ${isDisabled ? 'disabled' : ''}>
            ${slot.time}
            ${isFew ? '<span class="chip-badge few">FEW</span>' : ''}
          </button>
        `;
      }).join('');

      // Add click handlers
      container.querySelectorAll('.time-chip:not(.disabled)').forEach(chip => {
        chip.addEventListener('click', () => {
          container.querySelectorAll('.time-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          selectedTime = chip.dataset.time;

          // Show seat info
          const seats = parseInt(chip.dataset.seats);
          const status = chip.dataset.status;
          showSeatInfo(seats, status);
        });
      });

      // Show seat info if preselected
      if (preselect) {
        const slot = timeSlots.find(s => s.time === preselect);
        if (slot) showSeatInfo(slot.seats, slot.status);
      }
    }

    function showSeatInfo(seats, status) {
      const container = document.getElementById('seat-info-container');
      if (seats <= 5 && seats > 0) {
        container.innerHTML = `
          <div class="seat-info ${status === 'filling-fast' ? 'warning' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Only ${seats} seat${seats > 1 ? 's' : ''} left for this slot — book quickly!
          </div>
        `;
      } else if (seats > 5) {
        container.innerHTML = `
          <div class="seat-info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            ${seats} seats available — you're good to go!
          </div>
        `;
      } else {
        container.innerHTML = '';
      }
    }

    // Stepper
    const stepperMinus = document.getElementById('stepper-minus');
    const stepperPlus = document.getElementById('stepper-plus');
    const stepperValue = document.getElementById('stepper-value');

    stepperMinus?.addEventListener('click', () => {
      if (guestCount > 1) {
        guestCount--;
        stepperValue.textContent = guestCount;
        stepperValue.style.transform = 'scale(1.2)';
        setTimeout(() => stepperValue.style.transform = 'scale(1)', 200);
      }
    });

    stepperPlus?.addEventListener('click', () => {
      if (guestCount < 12) {
        guestCount++;
        stepperValue.textContent = guestCount;
        stepperValue.style.transform = 'scale(1.2)';
        setTimeout(() => stepperValue.style.transform = 'scale(1)', 200);
      }
    });

    // Multi-step navigation
    const steps = [
      document.getElementById('form-step-1'),
      document.getElementById('form-step-2'),
      document.getElementById('form-step-3'),
    ];

    const progressSteps = [
      document.getElementById('step-1'),
      document.getElementById('step-2'),
      document.getElementById('step-3'),
    ];

    const progressLines = [
      document.getElementById('line-1'),
      document.getElementById('line-2'),
    ];

    function goToStep(stepIndex) {
      steps.forEach((s, i) => {
        s.style.display = i === stepIndex ? 'block' : 'none';
      });

      progressSteps.forEach((s, i) => {
        s.classList.remove('active', 'completed');
        if (i < stepIndex) s.classList.add('completed');
        if (i === stepIndex) s.classList.add('active');
      });

      progressLines.forEach((l, i) => {
        l.classList.toggle('active', i < stepIndex);
      });

      // Animate step in
      steps[stepIndex].style.animation = 'fadeIn 0.35s ease';

      // Scroll to top of form
      document.querySelector('.booking-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Step 1 → Step 2
    document.getElementById('btn-next-1')?.addEventListener('click', () => {
      const date = dateInput.value;
      if (!date) {
        dateInput.focus();
        dateInput.style.borderColor = '#E05555';
        setTimeout(() => dateInput.style.borderColor = '', 2000);
        return;
      }
      if (!selectedTime) {
        const container = document.getElementById('time-chips');
        container.style.outline = '2px solid #E05555';
        container.style.outlineOffset = '4px';
        container.style.borderRadius = '8px';
        setTimeout(() => {
          container.style.outline = '';
          container.style.outlineOffset = '';
        }, 2000);
        return;
      }
      goToStep(1);
    });

    // Step 2 → Step 3
    document.getElementById('btn-next-2')?.addEventListener('click', () => {
      const name = document.getElementById('booking-name').value.trim();
      const phone = document.getElementById('booking-phone').value.trim();

      if (!name) {
        document.getElementById('booking-name').focus();
        document.getElementById('booking-name').style.borderColor = '#E05555';
        setTimeout(() => document.getElementById('booking-name').style.borderColor = '', 2000);
        return;
      }

      if (!phone || phone.length < 10) {
        document.getElementById('booking-phone').focus();
        document.getElementById('booking-phone').style.borderColor = '#E05555';
        setTimeout(() => document.getElementById('booking-phone').style.borderColor = '', 2000);
        return;
      }

      // Build review
      const dateObj = new Date(dateInput.value + 'T00:00:00');
      const dateFormatted = dateObj.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const reviewContainer = document.getElementById('review-details');
      const notes = document.getElementById('booking-notes').value.trim();
      reviewContainer.innerHTML = `
        <div class="detail-row">
          <span class="label">Name</span>
          <span class="value">${name}</span>
        </div>
        <div class="detail-row">
          <span class="label">Phone</span>
          <span class="value">${phone}</span>
        </div>
        <div class="detail-row">
          <span class="label">Date</span>
          <span class="value">${dateFormatted}</span>
        </div>
        <div class="detail-row">
          <span class="label">Time</span>
          <span class="value">${selectedTime}</span>
        </div>
        <div class="detail-row">
          <span class="label">Guests</span>
          <span class="value">${guestCount} ${guestCount === 1 ? 'person' : 'people'}</span>
        </div>
        ${notes ? `
        <div class="detail-row">
          <span class="label">Requests</span>
          <span class="value">${notes}</span>
        </div>` : ''}
      `;

      goToStep(2);
    });

    // Back buttons
    document.getElementById('btn-back-2')?.addEventListener('click', () => goToStep(0));
    document.getElementById('btn-back-3')?.addEventListener('click', () => goToStep(1));

    // Submit
    document.getElementById('booking-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('booking-name').value.trim();
      const phone = document.getElementById('booking-phone').value.trim();
      const email = document.getElementById('booking-email').value.trim();
      const notes = document.getElementById('booking-notes').value.trim();
      const date = dateInput.value;

      const dateObj = new Date(date + 'T00:00:00');
      const dateFormatted = dateObj.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const btn = document.getElementById('btn-confirm');
      const originalText = btn.innerHTML;
      btn.innerHTML = 'Processing...';
      btn.disabled = true;

      const bookingData = {
        name,
        phone,
        email,
        notes,
        date,
        dateFormatted,
        time: selectedTime,
        guests: guestCount,
        bookedAt: new Date().toISOString()
      };

      try {
        const response = await fetch('/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });

        if (response.ok) {
            localStorage.setItem('nook_booking', JSON.stringify(bookingData));
            
            // Animate button
            btn.innerHTML = '✓ Confirmed!';
            btn.style.background = '#5CB85C';

            // Redirect after brief delay
            setTimeout(() => {
                window.location.href = 'confirmation.html';
            }, 800);
        } else {
            alert('Failed to book. Please try again.');
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
      } catch (err) {
        alert('An error occurred. Please try again.');
        btn.innerHTML = originalText;
        btn.disabled = false;
      }
    });
  }

  // ---- Sticky CTA visibility (hide when hero CTA is visible) ----
  const stickyCta = document.getElementById('sticky-cta');
  const heroCta = document.getElementById('hero-book-btn');
  if (stickyCta && heroCta) {
    const stickyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        stickyCta.style.transform = entry.isIntersecting ? 'translateY(100%)' : 'translateY(0)';
        stickyCta.style.transition = 'transform 0.3s ease';
      });
    }, { threshold: 0 });
    stickyObserver.observe(heroCta);
  }

  // ---- Smooth scroll for anchor links ----
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
