require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const port = process.env.PORT || 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const userState = {};
const userTimeouts = {};

// Middleware to log requests
app.use((req, res, next) => {
    console.log('Request received:', req.method, req.url, req.body);
    next();
});

// Endpoint for receiving messages from WhatsApp
app.post('/webhook', async (req, res) => {
    const from = req.body.From;
    const body = req.body.Body ? req.body.Body.toLowerCase() : null;

    if (!from || !body) {
        res.status(400).send('Bad Request: Missing "From" or "Body" in the request');
        return;
    }

    console.log(`Processing message from ${from}: ${body}`);

    if (body === 'hello') {
        await startInteraction(from);
    } else if (userState[from] === 'initial') {
        if (body === 'done') {
            await ifActDone(from);
        } else if (body === 'not yet') {
            await sendMessage(from, "Don't worry, it's okay.");
        } else {
            await sendMessage(from, "Sorry, I didn't understand that.");
        }
    } else if (userState[from] === 'waitingForOptionAfter9Hours') {
        if (body === 'done') {
            await ifActDone(from);
        } else if (body === 'not yet') {
            await sendOptions(from);
            userState[from] = 'waitingForOptionSelection';
        } else {
            await sendMessage(from, "Sorry, I didn't understand that.");
        }
    } else if (userState[from] === 'waitingForOptionSelection') {
        await handleTaskSelection(from, body);
    } else if (userState[from] === 'waitingForCompletion') {
        if (body === 'done') {
            await ifActDone(from);
        } else if (body === 'not yet') {
            await sendMessage(from, "Don't worry, it's okay.");
        } else {
            await sendMessage(from, "Sorry, I didn't understand that.");
        }
    } else {
        await sendMessage(from, "Please start the conversation by saying 'Hello'.");
    }

    res.sendStatus(200);
});

const startInteraction = async (to) => {
    userState[to] = 'initial';
    await sendMessage(to, "Hello first message, is the act complete?");
    setReminder(to, 6 * 1000, "6 hours are up");
    setReminder(to, 15 * 1000, "9 hours are up, is the task complete?", 'waitingForOptionAfter9Hours');
};

const setReminder = (to, delay, message, nextState = null) => {
    const timeoutId = setTimeout(async () => {
        await sendMessage(to, message);
        if (nextState) {
            userState[to] = nextState;
        }
    }, delay);
    userTimeouts[to] = userTimeouts[to] || [];
    userTimeouts[to].push(timeoutId);
};

const clearReminders = (to) => {
    if (userTimeouts[to]) {
        userTimeouts[to].forEach(clearTimeout);
        userTimeouts[to] = [];
    }
};

const sendMessage = async (to, text) => {
    try {
        console.log(`Sending message to ${to}: ${text}`);
        await client.messages.create({
            from: 'whatsapp:+14155238886', // Your Twilio WhatsApp Sandbox number
            to: 'whatsapp:+919878417442', // Your Personal WhatsApp number
            body: text
        });
        console.log(`Message sent to ${to}`);
    } catch (error) {
        console.error('Error sending message:', error.message);
    }
};

const sendOptions = async (to) => {
    const options = [
        "a", "b", "c", "d", "e"
    ];
    const optionText = options.map((option, index) => `${index + 1}. ${option}`).join('\n');
    await sendMessage(to, optionText);
};

const handleTaskSelection = async (from, body) => {
    const options = {
        '1': 'a',
        '2': 'b',
        '3': 'c',
        '4': 'd',
        '5': 'e',
        'a': 'a',
        'b': 'b',
        'c': 'c',
        'd': 'd',
        'e': 'e'
    };

    const selectedOption = options[body];

    if (selectedOption) {
        await sendMessage(from, `You have picked option ${selectedOption}`);
    } else {
        await sendMessage(from, "Invalid option. Please choose a valid option (1-5 or a-e).");
        await sendOptions(from);
    }
};

const ifActDone = async (from) => {
    await sendMessage(from, "You have completed the act.");
    clearReminders(from);
    userState[from] = null;
};

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
