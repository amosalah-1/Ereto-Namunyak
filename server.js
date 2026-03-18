const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug Middleware: Log all requests to Vercel Function Logs
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url}`);
    next();
});

// Serve static files (HTML, CSS, JS, Images)
app.use(express.static(path.join(__dirname)));

// --- EMAIL CONFIGURATION ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Verify SMTP Connection on Startup
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ SMTP Connection Error:', error);
    } else {
        console.log('✅ SMTP Server is ready to send emails');
    }
});

// --- PESAPAL CONFIGURATION ---
const PESAPAL_URL = 'https://pay.pesapal.com/v3';
const PESAPAL_CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const PESAPAL_CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const PESAPAL_IPN_ID = process.env.PESAPAL_IPN_ID;

// Helper: Get Pesapal Auth Token
async function getPesapalToken() {
    try {
        if (!PESAPAL_CONSUMER_KEY || !PESAPAL_CONSUMER_SECRET) {
            throw new Error('Missing Pesapal credentials. Check PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET.');
        }
        const response = await axios.post(`${PESAPAL_URL}/api/Auth/RequestToken`, {
            consumer_key: PESAPAL_CONSUMER_KEY,
            consumer_secret: PESAPAL_CONSUMER_SECRET
        }, {
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        return response.data.token;
    } catch (error) {
        console.error("Pesapal Auth Error:", error.response ? error.response.data : error.message);
        throw new Error("Failed to authenticate with Payment Gateway");
    }
}

// Helper: Register IPN (Instant Payment Notification)
async function registerIPN(token, baseUrlOverride) {
    try {
        const ipnId = process.env.PESAPAL_IPN_ID;
        if (ipnId) return ipnId;

        // Use provided baseUrl or fallback to env, ensuring no trailing slash
        const baseUrl = (baseUrlOverride || process.env.BASE_URL || "").replace(/\/$/, "");
        const callbackUrl = `${baseUrl}/api/payment-ipn`;
        
        console.log(`Attempting to register IPN with URL: ${callbackUrl}`);

        const response = await axios.post(`${PESAPAL_URL}/api/URLSetup/RegisterIPN`, {
            url: callbackUrl,
            ipn_notification_type: 'GET'
        }, {
            headers: { 
                'Accept': 'application/json', 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data.ipn_id;
    } catch (error) {
        console.error("IPN Registration Error:", error.response ? JSON.stringify(error.response.data) : error.message);
        // Throw error so we can report it to the client
        throw new Error(`IPN Registration Failed: ${error.response?.data?.error?.message || error.message}`);
    }
}

// --- ROUTES ---

// 1. Send Email Route
app.post('/api/contact', async (req, res) => {
    const { from_name, from_email, message } = req.body;

    if (!from_name || !from_email || !message) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    const mailOptions = {
        from: {
            name: `Ereto Namunyak Website`, // The name that appears in the 'from' field
            address: process.env.SMTP_USER // The email address it is sent from
        },
        replyTo: from_email,
        to: process.env.EMAIL_TO,
        subject: `New Contact Message from ${from_name}`,
        text: `Name: ${from_name}\nEmail: ${from_email}\n\nMessage:\n${message}`,
        html: `<h3>New Message from Ereto Namunyak Website</h3>
               <p><strong>Name:</strong> ${from_name}</p>
               <p><strong>Email:</strong> <a href="mailto:${from_email}">${from_email}</a></p>
               <br>
               <p><strong>Message:</strong><br>${message.replace(/\n/g, '<br>')}</p>`
    };

    try {
        console.log(`Attempting to send contact email from ${from_email}...`);
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully! Message ID:', info.messageId);
        res.status(200).json({ success: true, message: 'Email sent successfully!' });
    } catch (error) {
        console.error('❌ Email sending failed:', error);
        res.status(500).json({ success: false, message: 'Failed to send email.' });
    }
});

// 2. Create Payment Route
app.post('/api/create-payment', async (req, res) => {
    const { amount, name, phone } = req.body;

    if (!amount || isNaN(amount) || amount < 1) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        // Ensure BASE_URL is defined
        if (!process.env.BASE_URL) {
            throw new Error("Server Error: BASE_URL is not configured in Environment Variables.");
        }
        
        // Clean BASE_URL (Remove trailing slash if present)
        const baseUrl = process.env.BASE_URL.replace(/\/$/, "");

        // Step 1: Get Token
        const token = await getPesapalToken();

        // Step 2: Register IPN (Instant Payment Notification)
        const ipnId = await registerIPN(token, baseUrl);
        if (!ipnId) {
            throw new Error("Failed to register IPN. Ensure BASE_URL is public and/or set PESAPAL_IPN_ID.");
        }
        
        // Step 3: Submit Order
        const orderId = `EN-${Date.now()}`; // Generate unique Order ID
        
        // Split name into first and last for Pesapal
        const nameParts = name ? name.trim().split(' ') : ['Anonymous'];
        const firstName = nameParts[0];
        // Fix: Pesapal requires a Last Name. If missing, reuse First Name or use 'Donor'.
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;
        
        const orderData = {
            id: orderId,
            currency: "KES",
            amount: parseFloat(amount),
            description: "Donation to Ereto Namunyak",
            callback_url: `${baseUrl}/index.html?status=success`, // Redirect here after payment
            notification_id: ipnId,
            billing_address: {
                email_address: "donor@anonymous.com", // Placeholder since we didn't ask for email
                phone_number: phone || "",
                country_code: "KE",
                first_name: firstName,
                last_name: lastName,
                line_1: "Donation",
                city: "Nairobi",
                state: "Nairobi",
                postal_code: "00100",
                zip_code: "00100"
            }
        };

        const response = await axios.post(`${PESAPAL_URL}/api/Transactions/SubmitOrderRequest`, orderData, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        res.json({ 
            redirect_url: response.data.redirect_url, 
            order_tracking_id: response.data.order_tracking_id 
        });

    } catch (error) {
        console.error("Payment Creation Error:", error);
        const msg = error.response?.data?.error?.message || error.response?.data?.message || error.message || "Unknown Error";
        res.status(500).json({ error: msg });
    }
});

// 3. IPN Callback Route (Called by Pesapal server)
app.get('/api/payment-ipn', async (req, res) => {
    const { OrderTrackingId, OrderMerchantReference } = req.query;
    console.log(`IPN Received for Order: ${OrderMerchantReference}, Tracking ID: ${OrderTrackingId}`);

    try {
        // 1. Get Access Token
        const token = await getPesapalToken();

        // 2. Query Pesapal for the actual status
        const statusUrl = `${PESAPAL_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}&orderMerchantReference=${OrderMerchantReference}`;
        
        const response = await axios.get(statusUrl, {
            headers: { 
                'Accept': 'application/json', 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            }
        });

        const { payment_status_description, amount, currency } = response.data;
        console.log(`✅ Payment Status: ${payment_status_description} | Amount: ${currency} ${amount}`);

        // OPTIONAL: Add code here to save to a database or send a "Thank You" email

    } catch (error) {
        console.error("❌ Error verifying payment status:", error.message);
    }

    // 3. Acknowledge receipt to Pesapal
    res.status(200).json({ 
        orderNotificationType: "GET", 
        orderTrackingId: OrderTrackingId, 
        orderMerchantReference: OrderMerchantReference, 
        status: 200 
    });
});

// Start Server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Local Server running at: http://localhost:${PORT}`);
        console.log(`🌍 Configured BASE_URL:   ${process.env.BASE_URL || '(Not Set)'}`);
        console.log(`ℹ️  Note: This log only appears on your computer. On Vercel, the app runs in the cloud.\n`);
    });
}

module.exports = app;
