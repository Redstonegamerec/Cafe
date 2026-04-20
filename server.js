const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

let transporter;
nodemailer.createTestAccount((err, account) => {
    if (!err) {
        transporter = nodemailer.createTransport({
            host: account.smtp.host,
            port: account.smtp.port,
            secure: account.smtp.secure,
            auth: { user: account.user, pass: account.pass }
        });
        console.log('Nodemailer Ethereal Mock Email ready.');
    }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('Connected to SQLite database.');
});

// Initialize database schema
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT,
        period TEXT,
        status TEXT,
        tables TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT,
        email TEXT,
        notes TEXT,
        date TEXT,
        dateFormatted TEXT,
        time TEXT,
        guests INTEGER,
        status TEXT DEFAULT 'confirmed',
        bookedAt TEXT,
        tableIds TEXT
    )`);

    // Seed slots if empty
    db.get('SELECT count(*) as count FROM slots', (err, row) => {
        if (row.count === 0) {
            const initialSlots = [
                { time: '8:00 AM', period: 'Morning', status: 'available' },
                { time: '9:30 AM', period: 'Morning', status: 'available' },
                { time: '11:00 AM', period: 'Brunch', status: 'available' },
                { time: '12:30 PM', period: 'Lunch', status: 'available' },
                { time: '2:00 PM', period: 'Afternoon', status: 'available' },
                { time: '4:00 PM', period: 'Tea Time', status: 'available' },
                { time: '6:00 PM', period: 'Evening', status: 'available' },
                { time: '7:30 PM', period: 'Dinner', status: 'available' },
                { time: '9:00 PM', period: 'Late Night', status: 'available' },
            ];

            const generateTables = () => JSON.stringify(Array.from({length: 10}, (_, i) => ({ id: i + 1, status: 'available' })));
            
            const stmt = db.prepare('INSERT INTO slots (time, period, status, tables) VALUES (?, ?, ?, ?)');
            initialSlots.forEach(s => {
                stmt.run(s.time, s.period, s.status, generateTables());
            });
            stmt.finalize();
        }
    });
});

// APIs
app.get('/api/slots', (req, res) => {
    db.all('SELECT * FROM slots', (err, rows) => {
        if (err) res.status(500).json({error: err.message});
        else {
            rows.forEach(r => {
                r.tables = JSON.parse(r.tables);
                // Dynamically calculate status and seats left purely for UI compatibility
                const availableCount = r.tables.filter(t => t.status === 'available').length;
                r.seats = availableCount * 4;
                if (availableCount === 0) r.status = 'full';
                else if (availableCount <= 2) r.status = 'filling-fast';
                else r.status = 'available';
            });
            res.json(rows);
        }
    });
});

app.post('/api/bookings', (req, res) => {
    const { name, phone, email, notes, date, dateFormatted, time, guests, bookedAt } = req.body;

    // 1. Get slot and allocate tables First
    db.get(`SELECT id, tables FROM slots WHERE time = ?`, [time], (err, slot) => {
        if (!slot) return res.status(404).json({error: "Time slot not found"});
        
        const tables = JSON.parse(slot.tables);
        const tablesNeeded = Math.ceil(guests / 4);
        let assigned = 0;
        const assignedIds = [];
        
        for (let i = 0; i < tables.length; i++) {
            if (tables[i].status === 'available' && assigned < tablesNeeded) {
                tables[i].status = 'booked';
                assignedIds.push(tables[i].id);
                assigned++;
            }
        }
        
        if (assigned < tablesNeeded) {
            return res.status(400).json({error: "Not enough table availability"});
        }

        // 2. Insert Booking with assignedIds
        db.run(
            `INSERT INTO bookings (name, phone, email, notes, date, dateFormatted, time, guests, bookedAt, tableIds) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, phone, email, notes, date, dateFormatted, time, guests, bookedAt, JSON.stringify(assignedIds)],
            function (err) {
                if (err) return res.status(500).json({error: err.message});
                
                const newBooking = { id: this.lastID, ...req.body, tableIds: JSON.stringify(assignedIds), status: 'confirmed' };
                io.emit('new-booking', newBooking);

                // Send Email Notification
                if (transporter && email) {
                    let message = {
                        from: '"The Nook Café" <reservations@thenookcafe.com>',
                        to: email,
                        subject: `Confirmation: Table Booking at The Nook for ${name}`,
                        html: `<div style="font-family: sans-serif; color: #333; padding: 20px;">
                                <h2 style="color: #C8A27C;">The Nook Café</h2>
                                <p>Dear <strong>${name}</strong>,</p>
                                <p>Thank you for choosing The Nook Café! Your table reservation has been successfully confirmed.</p>
                                <ul>
                                    <li><strong>Date:</strong> ${dateFormatted}</li>
                                    <li><strong>Time:</strong> ${time}</li>
                                    <li><strong>Guests:</strong> ${guests}</li>
                                    <li><strong>Assigned Tables:</strong> ${assignedIds.join(', ')}</li>
                                </ul>
                                <p>If you have any questions, feel free to contact us.</p>
                                <p>Best regards,<br>The Nook Team</p>
                               </div>`
                    };
                    transporter.sendMail(message, (err, info) => {
                        if (!err) {
                            console.log('Confirmation mock email sent! View it here: %s', nodemailer.getTestMessageUrl(info));
                        }
                    });
                }

                // 3. Update Slot with new table statues
                const availableCount = tables.filter(t => t.status === 'available').length;
                let newStatus = 'available';
                if (availableCount === 0) newStatus = 'full';
                else if (availableCount <= 2) newStatus = 'filling-fast';
                
                db.run(`UPDATE slots SET tables = ?, status = ? WHERE id = ?`, [JSON.stringify(tables), newStatus, slot.id], () => {
                    io.emit('slots-updated');
                });

                res.json({ success: true, booking: newBooking });
            }
        );
    });
});

app.get('/api/bookings', (req, res) => {
    db.all('SELECT * FROM bookings ORDER BY id DESC', (err, rows) => {
        if (err) res.status(500).json({error: err.message});
        else res.json(rows);
    });
});

app.put('/api/bookings/:id/cancel', (req, res) => {
    const bookingId = req.params.id;
    
    // 1. Get the booking to find its slot time and tableIds
    db.get('SELECT * FROM bookings WHERE id = ?', [bookingId], (err, booking) => {
        if (!booking || booking.status === 'cancelled') return res.status(404).json({error: "Booking not found or already cancelled"});
        
        const assignedIds = JSON.parse(booking.tableIds || "[]");
        
        // 2. Mark booking as cancelled
        db.run(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, [bookingId], (err) => {
            if (err) return res.status(500).json({error: err.message});
            
            io.emit('booking-cancelled', bookingId);
            
            // 3. Release the tables in slots
            db.get(`SELECT id, tables FROM slots WHERE time = ?`, [booking.time], (err, slot) => {
                if (slot) {
                    const tables = JSON.parse(slot.tables);
                    tables.forEach(t => {
                        if (assignedIds.includes(t.id) && t.status === 'booked') {
                            t.status = 'available'; // Release it back!
                        }
                    });
                    
                    const availableCount = tables.filter(t => t.status === 'available').length;
                    let newStatus = 'available';
                    if (availableCount === 0) newStatus = 'full';
                    else if (availableCount <= 2) newStatus = 'filling-fast';
                    
                    db.run(`UPDATE slots SET tables = ?, status = ? WHERE id = ?`, [JSON.stringify(tables), newStatus, slot.id], () => {
                        io.emit('slots-updated');
                    });
                }
            });
            
            res.json({ success: true });
        });
    });
});

app.post('/api/slots/:slotId/table/:tableId', (req, res) => {
    const { status } = req.body; // 'available', 'booked', or 'blocked'
    db.get(`SELECT id, tables FROM slots WHERE id = ?`, [req.params.slotId], (err, slot) => {
        if (slot) {
            const tables = JSON.parse(slot.tables);
            const table = tables.find(t => t.id == req.params.tableId);
            if (table) {
                table.status = status;
                
                // Recalculate status
                const availableCount = tables.filter(t => t.status === 'available').length;
                let newStatus = 'available';
                if (availableCount === 0) newStatus = 'full';
                else if (availableCount <= 2) newStatus = 'filling-fast';
                
                db.run(`UPDATE slots SET tables = ?, status = ? WHERE id = ?`, [JSON.stringify(tables), newStatus, slot.id], () => {
                    io.emit('slots-updated');
                    res.json({ success: true });
                });
            } else {
                res.status(404).json({error: "Table not found"});
            }
        } else {
            res.status(404).json({error: "Slot not found"});
        }
    });
});

app.get('/api/stats', (req, res) => {
    db.get('SELECT count(*) as totalBookings FROM bookings', (err, row1) => {
        db.all('SELECT time, guests FROM bookings', (err, rows) => {
            const totalGuests = rows.reduce((acc, curr) => acc + curr.guests, 0);
            res.json({ totalBookings: row1.totalBookings, totalGuests });
        });
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
