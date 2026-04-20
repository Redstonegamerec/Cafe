const express = require('express');
const { createClient } = require('@libsql/client');
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

// Basic Auth Middleware for Admin Routes
const adminAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    // Make sure to use environment variables in production!
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'password123';

    if (login && password && login === adminUser && password === adminPass) {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
    res.status(401).send('Authentication required. Please log in.');
};

// Protect the admin HTML page
app.use('/admin.html', adminAuth);

app.use(express.static(__dirname));

// Initialize Turso/SQLite Client
const db = createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:./database.sqlite',
    authToken: process.env.TURSO_AUTH_TOKEN
});
console.log('Connected to Turso/SQLite database.');

// Initialize database schema
(async () => {
    try {
        await db.execute(`CREATE TABLE IF NOT EXISTS slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT,
            period TEXT,
            status TEXT,
            tables TEXT
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS bookings (
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
        const res = await db.execute('SELECT count(*) as count FROM slots');
        if (Number(res.rows[0].count) === 0) {
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
            
            for (const s of initialSlots) {
                await db.execute({
                    sql: 'INSERT INTO slots (time, period, status, tables) VALUES (?, ?, ?, ?)',
                    args: [s.time, s.period, s.status, generateTables()]
                });
            }
        }
    } catch (err) {
        console.error('Database initialization error:', err);
    }
})();

// APIs
app.get('/api/slots', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM slots');
        const rows = result.rows;
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
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.post('/api/bookings', async (req, res) => {
    const { name, phone, email, notes, date, dateFormatted, time, guests, bookedAt } = req.body;

    try {
        // 1. Get slot and allocate tables First
        const slotRes = await db.execute({
            sql: `SELECT id, tables FROM slots WHERE time = ?`,
            args: [time]
        });
        
        if (slotRes.rows.length === 0) return res.status(404).json({error: "Time slot not found"});
        
        const slot = slotRes.rows[0];
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
        const insertRes = await db.execute({
            sql: `INSERT INTO bookings (name, phone, email, notes, date, dateFormatted, time, guests, bookedAt, tableIds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [name, phone, email, notes, date, dateFormatted, time, guests, bookedAt, JSON.stringify(assignedIds)]
        });
        
        const newBooking = { id: Number(insertRes.lastInsertRowid), ...req.body, tableIds: JSON.stringify(assignedIds), status: 'confirmed' };
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

        // 3. Update Slot with new table statuses
        const availableCount = tables.filter(t => t.status === 'available').length;
        let newStatus = 'available';
        if (availableCount === 0) newStatus = 'full';
        else if (availableCount <= 2) newStatus = 'filling-fast';
        
        await db.execute({
            sql: `UPDATE slots SET tables = ?, status = ? WHERE id = ?`,
            args: [JSON.stringify(tables), newStatus, slot.id]
        });
        
        io.emit('slots-updated');
        res.json({ success: true, booking: newBooking });

    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.get('/api/bookings', adminAuth, async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM bookings ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.put('/api/bookings/:id/cancel', adminAuth, async (req, res) => {
    const bookingId = req.params.id;
    
    try {
        // 1. Get the booking to find its slot time and tableIds
        const bookingRes = await db.execute({
            sql: 'SELECT * FROM bookings WHERE id = ?',
            args: [bookingId]
        });
        
        if (bookingRes.rows.length === 0) return res.status(404).json({error: "Booking not found or already cancelled"});
        const booking = bookingRes.rows[0];
        if (booking.status === 'cancelled') return res.status(404).json({error: "Booking not found or already cancelled"});
        
        const assignedIds = JSON.parse(booking.tableIds || "[]");
        
        // 2. Mark booking as cancelled
        await db.execute({
            sql: `UPDATE bookings SET status = 'cancelled' WHERE id = ?`,
            args: [bookingId]
        });
        
        io.emit('booking-cancelled', bookingId);
        
        // 3. Release the tables in slots
        const slotRes = await db.execute({
            sql: `SELECT id, tables FROM slots WHERE time = ?`,
            args: [booking.time]
        });
        
        if (slotRes.rows.length > 0) {
            const slot = slotRes.rows[0];
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
            
            await db.execute({
                sql: `UPDATE slots SET tables = ?, status = ? WHERE id = ?`,
                args: [JSON.stringify(tables), newStatus, slot.id]
            });
            
            io.emit('slots-updated');
        }
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.post('/api/slots/:slotId/table/:tableId', adminAuth, async (req, res) => {
    const { status } = req.body; // 'available', 'booked', or 'blocked'
    try {
        const slotRes = await db.execute({
            sql: `SELECT id, tables FROM slots WHERE id = ?`,
            args: [req.params.slotId]
        });
        
        if (slotRes.rows.length > 0) {
            const slot = slotRes.rows[0];
            const tables = JSON.parse(slot.tables);
            const table = tables.find(t => t.id == req.params.tableId);
            if (table) {
                table.status = status;
                
                // Recalculate status
                const availableCount = tables.filter(t => t.status === 'available').length;
                let newStatus = 'available';
                if (availableCount === 0) newStatus = 'full';
                else if (availableCount <= 2) newStatus = 'filling-fast';
                
                await db.execute({
                    sql: `UPDATE slots SET tables = ?, status = ? WHERE id = ?`,
                    args: [JSON.stringify(tables), newStatus, slot.id]
                });
                
                io.emit('slots-updated');
                res.json({ success: true });
            } else {
                res.status(404).json({error: "Table not found"});
            }
        } else {
            res.status(404).json({error: "Slot not found"});
        }
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

app.get('/api/stats', adminAuth, async (req, res) => {
    try {
        const countRes = await db.execute('SELECT count(*) as totalBookings FROM bookings');
        const bookingsRes = await db.execute('SELECT time, guests FROM bookings');
        
        const totalGuests = bookingsRes.rows.reduce((acc, curr) => acc + Number(curr.guests), 0);
        res.json({ totalBookings: Number(countRes.rows[0].totalBookings), totalGuests });
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
