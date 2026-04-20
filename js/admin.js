document.addEventListener('DOMContentLoaded', () => {
    
    // Elements
    const tbody = document.getElementById('bookings-tbody');
    const totalBookingsEl = document.getElementById('stat-total-bookings');
    const totalGuestsEl = document.getElementById('stat-total-guests');
    const slotsGrid = document.getElementById('slots-grid');

    // Fetch Initial Data
    async function fetchStats() {
        try {
            const res = await fetch('/api/stats');
            if (res.ok) {
                const data = await res.json();
                totalBookingsEl.textContent = data.totalBookings;
                totalGuestsEl.textContent = data.totalGuests;
            }
        } catch (e) {
            console.error('Failed to fetch stats:', e);
        }
    }

    async function fetchBookings() {
        try {
            const res = await fetch('/api/bookings');
            if (res.ok) {
                const bookings = await res.json();
                renderTable(bookings);
            }
        } catch (e) {
            console.error('Failed to fetch bookings:', e);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #E05555;">Error loading data. Is the server running?</td></tr>';
        }
    }

    function createRowHTML(b) {
        const isCancelled = b.status === 'cancelled';
        const assignedIdsContent = b.tableIds && b.tableIds.length > 2 ? `<div style="margin-top:4px; font-size:0.75rem; color:#888;">Tables: ${JSON.parse(b.tableIds).join(', ')}</div>` : '';
        
        return `
            <tr style="${isCancelled ? 'opacity: 0.5; text-decoration: line-through;' : ''}">
                <td>
                    <div style="font-weight: 600;">${b.name}</div>
                    ${b.notes ? `<div style="font-size: 0.8rem; color: #6B6B6B; margin-top: 4px;">📝 ${b.notes}</div>` : ''}
                </td>
                <td>
                    <div>${b.phone}</div>
                    <div style="font-size: 0.8rem; color: #6B6B6B;">${b.email || 'No email'}</div>
                </td>
                <td>
                    <div style="font-weight: 500;">${b.dateFormatted}</div>
                    <div style="font-size: 0.85rem; color: #C8A27C;">${b.time}</div>
                </td>
                <td>
                    <strong>${b.guests}</strong> pax
                    ${assignedIdsContent}
                </td>
                <td>
                    <span class="badge ${b.status}">${b.status}</span>
                    ${!isCancelled ? `<button onclick="window.cancelBooking(${b.id})" style="margin-left: 12px; background: none; border: none; color: #E05555; cursor: pointer; text-decoration: underline; font-size: 0.8rem;">Cancel</button>` : ''}
                </td>
            </tr>
        `;
    }

    let bookingToCancelId = null;
    const cancelModal = document.getElementById('cancel-modal');

    window.cancelBooking = (id) => {
        bookingToCancelId = id;
        cancelModal.classList.add('active');
    };

    document.getElementById('modal-close').addEventListener('click', () => {
        cancelModal.classList.remove('active');
        bookingToCancelId = null;
    });

    document.getElementById('modal-confirm').addEventListener('click', async () => {
        if (!bookingToCancelId) return;
        const id = bookingToCancelId;
        cancelModal.classList.remove('active');
        bookingToCancelId = null;
        
        try {
            await fetch(`/api/bookings/${id}/cancel`, { method: 'PUT' });
        } catch (e) {
            console.error('Failed to cancel booking', e);
        }
    });

    function renderTable(bookings) {
        if (bookings.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #9A9A9A;">No reservations yet.</td></tr>';
            return;
        }

        tbody.innerHTML = bookings.map(createRowHTML).join('');
    }

    // Initialize
    fetchStats();
    fetchBookings();
    fetchSlots();

    async function fetchSlots() {
        try {
            const res = await fetch('/api/slots');
            if (res.ok) {
                const slots = await res.json();
                renderSlots(slots);
            }
        } catch(e) {
            console.error('Failed to fetch slots:', e);
        }
    }

    function renderSlots(slots) {
        if (!slotsGrid) return;
        slotsGrid.innerHTML = slots.map(s => {
            const isFull = s.status === 'full';
            
            // Build the 10-table grid HTML
            const tablesHtml = s.tables.map(t => {
                // If booked, clicking shouldn't do anything or could cancel? Let's just toggle available/blocked.
                const nextStatus = t.status === 'blocked' ? 'available' : (t.status === 'available' ? 'blocked' : t.status);
                const clickHandler = t.status !== 'booked' ? `onclick="window.toggleTable(${s.id}, ${t.id}, '${nextStatus}')"` : `onclick="alert('Table is booked by a customer and cannot be manually blocked.')"`;
                
                return `<div class="table-node ${t.status}" title="Table ${t.id} - ${t.status}" ${clickHandler}>${t.id}</div>`;
            }).join('');

            return `
                <div class="admin-slot-card ${isFull ? 'full' : ''}">
                    <div class="admin-slot-header" style="margin-bottom: 4px;">
                        <strong>${s.time}</strong>
                        <span style="font-size: 0.8rem; color: #888;">${s.period}</span>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">Capacity: ${s.seats} / 40 seats</div>
                    <div class="tables-grid">
                        ${tablesHtml}
                    </div>
                    ${ s.id === 1 ? `
                    <div class="tables-legend">
                        <div class="legend-item"><div class="legend-dot" style="background: #E0E0E0;"></div> Avail</div>
                        <div class="legend-item"><div class="legend-dot" style="background: #BBDEFB;"></div> Booked</div>
                        <div class="legend-item"><div class="legend-dot" style="background: #FFCDCD;"></div> Blocked</div>
                    </div>` : '' }
                </div>
            `;
        }).join('');
    }

    window.toggleTable = async (slotId, tableId, newStatus) => {
        try {
            await fetch(`/api/slots/${slotId}/table/${tableId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
        } catch (e) {
            console.error('Failed to update table', e);
        }
    };

    // Socket.io for Live Updates
    if (typeof io !== 'undefined') {
        const socket = io();

        // Listen for new booking
        socket.on('new-booking', (booking) => {
            // Re-fetch stats
            fetchStats();
            
            // Add row to table organically
            const tr = document.createElement('tr');
            tr.innerHTML = createRowHTML(booking);

            // Highlight animation
            tr.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
            tr.style.transition = 'background-color 2s ease';
            
            // If table was empty, clear it first
            if (tbody.querySelector('td[colspan]')) {
                tbody.innerHTML = '';
            }

            tbody.insertBefore(tr, tbody.firstChild);

            setTimeout(() => {
                tr.style.backgroundColor = '';
            }, 2000);
        });

        // Listen for slot updates
        socket.on('slots-updated', () => {
            fetchSlots();
        });

        // Listen for booking cancellations
        socket.on('booking-cancelled', () => {
            fetchStats();
            fetchBookings();
            fetchSlots();
        });
    }

});
