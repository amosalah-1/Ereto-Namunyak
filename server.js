const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const REQUIRED_SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_TO'];

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML, CSS, JS, Images) from the current folder
app.use(express.static(__dirname));

// Debug middleware for local and Vercel function logs
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
});

function getEnvValue(key) {
    const value = process.env[key];
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().replace(/^['"]|['"]$/g, '');
}

function getMissingEnvVars(keys) {
    return keys.filter((key) => !getEnvValue(key));
}

function getRuntimeLabel() {
    return getEnvValue('VERCEL_ENV') || getEnvValue('NODE_ENV') || 'local';
}

function formatMailError(error) {
    if (error.code === 'EAUTH') {
        return 'SMTP authentication failed. Check SMTP_USER and SMTP_PASS in Vercel.';
    }

    if (error.code === 'ESOCKET' || error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
        return 'SMTP connection failed. Check SMTP_HOST, SMTP_PORT, and whether your mail provider accepts this connection.';
    }

    return error.message || 'Failed to send email.';
}

// --- SUPABASE CONFIGURATION ---
const supabaseUrl = getEnvValue('SUPABASE_URL');
const supabaseKey = getEnvValue('SUPABASE_KEY');

// Debug: Warn if specific keys are missing
if (!supabaseUrl) console.warn('⚠️  Warning: SUPABASE_URL not found in .env file');
if (!supabaseKey) console.warn('⚠️  Warning: SUPABASE_KEY not found in .env file');

// Initialize Supabase client if keys are present
const supabase = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

if (supabase) {
    // Test the connection by running a lightweight query
    supabase.from('members').select('id').limit(1)
        .then(({ error }) => {
            if (error) console.error('❌ Supabase Connection Failed:', error.message);
            else console.log('✅ Supabase Connected: Ready to accept members.');
        });
} else {
    console.log('⚠️ Supabase keys missing. The /api/join route will not save to database.');
}

// --- PESAPAL CONFIGURATION ---
const PESAPAL_URL = 'https://pay.pesapal.com/v3';
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;

// In-memory cache for the Pesapal token
let pesapalTokenCache = { token: null, expires_at: 0 };

// Helper: Get Pesapal Auth Token
async function getPesapalToken() {
    try {
        if (!PESAPAL_CONSUMER_KEY || !PESAPAL_CONSUMER_SECRET) {
            throw new Error('Missing Pesapal credentials. Check PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET.');
        }

        // If we have a valid token in cache, return it
        if (pesapalTokenCache.token && pesapalTokenCache.expires_at > Date.now()) {
            console.log('Using cached Pesapal token.');
            return pesapalTokenCache.token;
        }

        const response = await axios.post(
            `${PESAPAL_URL}/api/Auth/RequestToken`,
            {
                consumer_key: PESAPAL_CONSUMER_KEY,
                consumer_secret: PESAPAL_CONSUMER_SECRET
            },
            {
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        );

        const tokenData = response.data;
        // Pesapal returns an expiryDate string. We convert it to a timestamp.
        const expiryTime = new Date(tokenData.expiryDate).getTime();
        pesapalTokenCache = {
            token: tokenData.token,
            expires_at: isNaN(expiryTime) ? Date.now() + 3500 * 1000 : expiryTime
        };
        console.log('Fetched and cached a new Pesapal token.');
        return pesapalTokenCache.token;
    } catch (error) {
        console.error('Pesapal Auth Error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to authenticate with Payment Gateway');
    }
}

// Helper: Register IPN (Instant Payment Notification)
async function registerIPN(token, baseUrlOverride) {
    try {
        const ipnId = process.env.PESAPAL_IPN_ID;

        if (ipnId && ipnId.trim().length > 30) {
            console.log('Using pre-configured PESAPAL_IPN_ID.');
            return ipnId;
        }

        if (ipnId) {
            console.warn(`Warning: PESAPAL_IPN_ID is set but looks invalid (${ipnId}). Ignoring it.`);
        }

        console.log('PESAPAL_IPN_ID not set. Proceeding with dynamic IPN registration.');

        const baseUrl = (baseUrlOverride || process.env.BASE_URL || '').replace(/\/$/, '');
        if (!baseUrl) {
            throw new Error('Cannot register IPN: BASE_URL is not set in environment variables.');
        }

        const callbackUrl = `${baseUrl}/api/payment-ipn`;
        console.log(`Attempting to register IPN with URL: ${callbackUrl}`);

        const response = await axios.post(
            `${PESAPAL_URL}/api/URLSetup/RegisterIPN`,
            {
                url: callbackUrl,
                ipn_notification_type: 'GET'
            },
            {
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                }
            }
        );

        console.log(`Dynamically registered IPN. Received ID: ${response.data.ipn_id}`);
        return response.data.ipn_id;
    } catch (error) {
        console.error('IPN Registration Error:', error.response ? JSON.stringify(error.response.data) : error.message);
        throw new Error(`IPN Registration Failed: ${error.response?.data?.error?.message || error.message}`);
    }
}

// --- ROUTES ---

// 1. Send Email Route
app.post('/api/contact', async (req, res) => {
    try {
        const { from_name, from_email, message } = req.body;

        if (!from_name || !from_email || !message) {
            return res.status(400).json({ success: false, message: 'Missing required fields.' });
        }

        const missingSmtpVars = getMissingEnvVars(REQUIRED_SMTP_VARS);
        if (missingSmtpVars.length > 0) {
            console.error('Missing SMTP environment variables:', {
                runtime: getRuntimeLabel(),
                missing: missingSmtpVars
            });
            throw new Error(`Server Config Error [${getRuntimeLabel()}]: Missing SMTP settings in deployment: ${missingSmtpVars.join(', ')}`);
        }

        const smtpHost = getEnvValue('SMTP_HOST');
        const smtpUser = getEnvValue('SMTP_USER');
        const emailTo = getEnvValue('EMAIL_TO');
        const cleanPass = getEnvValue('SMTP_PASS').replace(/\s+/g, '');
        const smtpPort = parseInt(getEnvValue('SMTP_PORT'), 10) || 465;

        console.log(`Preparing to send email via ${smtpHost}:${smtpPort}`);

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            requireTLS: smtpPort === 587,
            auth: {
                user: smtpUser,
                pass: cleanPass
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        const mailOptions = {
            from: {
                name: 'Ereto Namunyak Website',
                address: smtpUser
            },
            replyTo: {
                name: from_name,
                address: from_email
            },
            to: emailTo,
            subject: `New Contact Message from ${from_name}`,
            text: `Name: ${from_name}\nEmail: ${from_email}\n\nMessage:\n${message}`,
            html: `<h3>New Message from Ereto Namunyak Website</h3>
                   <p><strong>Name:</strong> ${from_name}</p>
                   <p><strong>Email:</strong> <a href="mailto:${from_email}">${from_email}</a></p>
                   <br>
                   <p><strong>Message:</strong><br>${message.replace(/\n/g, '<br>')}</p>`
        };

        console.log(`Attempting to send contact email from ${from_email}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully. Message ID:', info.messageId);
        res.status(200).json({ success: true, message: 'Email sent successfully!' });
    } catch (error) {
        const safeMessage = formatMailError(error);
        console.error('Email sending failed:', {
            message: safeMessage,
            originalMessage: error.message,
            code: error.code,
            response: error.response
        });
        res.status(500).json({ success: false, message: safeMessage });
    }
});

// 2. Join Us Route (Database Save)
app.post('/api/join', async (req, res) => {
    try {
        const { name, email, phone } = req.body;

        if (!name || !email) {
            return res.status(400).json({ success: false, message: 'Name and Email are required.' });
        }

        if (!supabase) {
            console.error('Supabase keys missing.');
            return res.status(500).json({ success: false, message: 'Database not configured.' });
        }

        // Insert data into 'members' table
        const { error } = await supabase
            .from('members')
            .insert({ name, email, phone });

        if (error) throw error;

        // --- Send Welcome Email ---
        // We reuse the SMTP settings to send a confirmation to the user
        const smtpHost = getEnvValue('SMTP_HOST');
        const smtpUser = getEnvValue('SMTP_USER');
        const cleanPass = getEnvValue('SMTP_PASS').replace(/\s+/g, '');
        const smtpPort = parseInt(getEnvValue('SMTP_PORT'), 10) || 465;

        if (smtpHost && smtpUser && cleanPass) {
            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: smtpPort,
                secure: smtpPort === 465,
                requireTLS: smtpPort === 587,
                auth: { user: smtpUser, pass: cleanPass },
                tls: { rejectUnauthorized: false }
            });

            const mailOptions = {
                from: { name: 'Ereto Namunyak', address: smtpUser },
                to: email,
                subject: 'Welcome to Ereto Namunyak Community Based Organization',
                text: `Hello ${name},\n\nWelcome to Ereto Namunyak Community Based Organization. You are now a member of the organization.\n\nWe are thrilled to have you with us.\n\nBest Regards,\nThe Ereto Namunyak Team`,
                html: `<h3>Welcome, ${name}!</h3><p>Welcome to <strong>Ereto Namunyak Community Based Organization</strong>. You are now a member of the organization.</p><p>We are thrilled to have you with us.</p><br><p>Best Regards,<br>The Ereto Namunyak Team</p>`
            };

            // VERCEL FIX: We must await the email, otherwise the serverless function pauses immediately.
            try {
                await transporter.sendMail(mailOptions);
            } catch (emailError) {
                console.error('Failed to send welcome email:', emailError.message);
            }
        }

        res.status(201).json({ success: true, message: 'Welcome to the Organization, A confirmation email has been sent' });
    } catch (error) {
        console.error('Supabase/Join Error:', error);
        res.status(500).json({ success: false, message: 'Server error processing request.' });
    }
});

// 3. Create Payment Route
app.post('/api/create-payment', async (req, res) => {
    const { amount, name, phone, email } = req.body;

    if (!amount || Number.isNaN(Number(amount)) || Number(amount) < 1) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        if (!process.env.BASE_URL) {
            throw new Error('Server Error: BASE_URL is not configured in Environment Variables.');
        }

        const baseUrl = process.env.BASE_URL.replace(/\/$/, '');

        const token = await getPesapalToken();
        const ipnId = await registerIPN(token, baseUrl);
        if (!ipnId) {
            throw new Error('Failed to register IPN. Ensure BASE_URL is public and/or set PESAPAL_IPN_ID.');
        }

        const orderId = `EN-${Date.now()}`;
        const nameParts = name ? name.trim().split(' ') : ['Anonymous'];
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;

        const orderData = {
            id: orderId,
            currency: 'KES',
            amount: parseFloat(amount),
            description: 'Donation to Ereto Namunyak',
            callback_url: `${baseUrl}/index.html?status=success`,
            notification_id: ipnId,
            billing_address: {
                email_address: email || 'donor@anonymous.com',
                phone_number: phone || '',
                country_code: 'KE',
                first_name: firstName,
                last_name: lastName,
                line_1: 'Donation',
                city: 'Nairobi',
                state: 'Nairobi',
                postal_code: '00100',
                zip_code: '00100'
            }
        };

        const response = await axios.post(
            `${PESAPAL_URL}/api/Transactions/SubmitOrderRequest`,
            orderData,
            {
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                }
            }
        );

        res.json({
            redirect_url: response.data.redirect_url,
            order_tracking_id: response.data.order_tracking_id
        });
    } catch (error) {
        console.error('Payment Creation Error:', error);
        const msg = error.response?.data?.error?.message || error.response?.data?.message || error.message || 'Unknown Error';
        res.status(500).json({ error: msg });
    }
});

// 3. IPN Callback Route (Called by Pesapal server)
app.get('/api/payment-ipn', async (req, res) => {
    const { OrderTrackingId, OrderMerchantReference } = req.query;
    console.log(`IPN Received for Order: ${OrderMerchantReference}, Tracking ID: ${OrderTrackingId}`);

    try {
        const token = await getPesapalToken();
        const statusUrl = `${PESAPAL_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}&orderMerchantReference=${OrderMerchantReference}`;

        const response = await axios.get(statusUrl, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            }
        });

        const { payment_status_description, amount, currency } = response.data;
        console.log(`Payment Status: ${payment_status_description} | Amount: ${currency} ${amount}`);

        // Optional: save to a database or send a thank-you email here.
    } catch (error) {
        console.error('Error verifying payment status:', error.message);
    }

    res.status(200).json({
        orderNotificationType: 'GET',
        orderTrackingId: OrderTrackingId,
        orderMerchantReference: OrderMerchantReference,
        status: 200
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\nLocal Server running at: http://localhost:${PORT}`);
        console.log(`Configured BASE_URL:   ${process.env.BASE_URL || '(Not Set)'}`);
        console.log('Note: This log only appears on your computer. On Vercel, the app runs in the cloud.\n');
    });
}

module.exports = app;
