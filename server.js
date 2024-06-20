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
const userFeedback = {};
const userInteractions = {}; // Track user interactions

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
    console.log('Received message:', body, 'from', from);

    let responseMessage = '';

    // Check if this is the user's first interaction
    if (!userState[from]) {
        userState[from] = { status: 'askName' };
        responseMessage = "Hi there! What's your name?";
        await sendMessage(from, responseMessage);
        return res.status(200).end();
    }

    const userName = userState[from] && userState[from].name ? userState[from].name : "{Name}";

    // Handle user's name input
    if (userState[from].status === 'askName') {
        userState[from].name = body;
        userState[from].status = 'initial';
        responseMessage = `Thanks, ${body}!`;
        await sendMessage(from, responseMessage);
        responseMessage = await startInteraction(from, userName);
        await sendMessage(from, responseMessage);
        return res.status(200).end();
    }

    // Continue with the regular flow of the conversation
    if (/^(hello|hi|hey|hi\schat|Hello|Hi)$/i.test(body)) {
        responseMessage = await startInteraction(from, userName);
    } else if (userState[from].status === 'initial') {
        if (body === 'done') {
            responseMessage = await ifActDone(from, userName);
        } else if (body === 'not yet') {
            responseMessage = "No problem! Don’t worry about it. We’re not always in the mood. Tomorrow is another day and you’ll have another opportunity to spread kindness to yourself or others.😊";
        } else {
            responseMessage = "Sorry, I didn't understand that.";
        }
    } else if (userState[from].status === 'waitingForOptionAfter9Hours') {
        if (body === 'done') {
            responseMessage = await ifActDone(from, userName);
        } else if (body === 'not yet') {
            responseMessage = await sendOptions(from);
            userState[from].status = 'waitingForOptionSelection';
        } else {
            responseMessage = "Sorry, I didn't understand that.";
        }
    } else if (userState[from].status === 'waitingForOptionSelection') {
        responseMessage = await handleTaskSelection(from, body);
    } else if (userState[from].status === 'waitingForFeedbackOption') {
        responseMessage = await handleFeedbackOption(from, body);
    } else if (userState[from].status === 'waitingForFeedback') {
        responseMessage = await handleFeedback(from, body);
    } else if (userState[from].status === 'waitingForCompletion') {
        if (body === 'done') {
            responseMessage = await ifActDone(from, userName);
        } else if (body === 'not yet') {
            responseMessage = "No problem! Don’t worry about it. We’re not always in the mood. Tomorrow is another day and you’ll have another opportunity to spread kindness to yourself or others.😊";
        } else {
            responseMessage = "Sorry, I didn't understand that.";
        }
    } else if (userState[from].status && userState[from].status.startsWith('postActMeasures')) {
        responseMessage = await handlePostActMeasures(from, body);
    } else {
        responseMessage = "Please start the conversation by saying 'Hello'.";
    }

    if (responseMessage) {
        await sendMessage(from, responseMessage);
    }

    res.status(200).end();
});

const startInteraction = async (to, name) => {
    userState[to].status = 'initial';
    const message = `Thanks again for sharing all that information about you, ${name}. It sounds like you had a difficult year so before caring for others, we’d like you first to focus on yourself. Kindness to oneself is just as important. Please take some time for you today with this small act: [add low effort self-care act]. Once you do, please let us know by texting “done”. Take care of yourself today!`;
    await sendMessage(to, message);
    setReminder(to, 6 * 1000, `Hey ${name}, don’t forget to care for yourself today with our suggested act. Or with anything else that might bring you a smile. Just take a moment today to care for you. It’s as important as caring for others. ❤️`);
    setReminder(to, 9 * 1000, `Hi ${name}, just checking if you took a moment to do something nice for you. Please respond “Done” or “Not Yet”. Thank you for being part of this journey!❤️`, 'waitingForOptionAfter9Hours');
    return '';
};

const setReminder = (to, delay, message, nextState = null) => {
    const timeoutId = setTimeout(async () => {
        await sendMessage(to, message);
        if (nextState) {
            userState[to].status = nextState;
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
            to: to, // The user's WhatsApp number
            body: text.replace(/\{Name\}/gi, userState[to].name) // Replace {Name} with user's name
        });
        console.log(`Message sent to ${to}`);
    } catch (error) {
        console.error('Error sending message:', error.message);
    }
};

const sendOptions = async (to) => {
    const options = [
        "Time constraints", 
        "Personal or work-related stress", 
        "Act not relevant, or appealing to me", 
        "Plan to do it later", 
        "Other"
    ];
    const optionText = options.map((option, index) => `${index + 1}. ${option}`).join('\n');
    await sendMessage(to, optionText);
    return '';
};

const handleTaskSelection = async (from, body) => {
    const options = {
        '1': "Time can feel like a scarce resource. However, taking a moment for yourself can be incredibly rejuvenating. What we suggested won't take much of your time, but it could help you recharge and be more effective with your tasks ahead. Give yourself permission to indulge, even if it's just for a few moments. You deserve this! 🌟 Don’t forget to tell us you’ve completed it by sending “Done”.",
        '2': "It sounds like you’ve got a lot on your plate right now. Prioritizing self-care, especially when you’re stressed, can help you recharge and navigate through tough times more effectively. What we suggested won't take much of your time and it can help you relieve your stress. Give yourself permission to indulge, even if it's just for a few moments. You deserve this! 🌟 Don’t forget to tell us you’ve completed it by sending “Done”.",
        '3': "No worries, not everything resonates with everyone. If you’d like, we can provide other suggestions. If not, remember that taking time for yourself is still important. Whatever you choose, we’re here to support you. 🌟 Don’t forget to tell us you’ve completed it by sending “Done”.",
        '4': "That’s totally okay! You can always do it later when you have the time and feel more in the mood for it. Remember, kindness to oneself is just as important as kindness to others. Whenever you’re ready, we’ll be here to cheer you on! 🌟 Don’t forget to tell us you’ve completed it by sending “Done”.",
        '5': "Thank you for sharing. Everyone has unique circumstances. If you’d like, you can tell us more about what might work better for you. We’re here to support you in finding what brings you joy and peace. 🌟 Don’t forget to tell us you’ve completed it by sending “Done”."
    };

    const selectedOption = options[body];
    if (selectedOption) {
        userState[from].status = 'waitingForCompletion';
        await sendMessage(from, selectedOption);
        return '';
    } else {
        return "Sorry, I didn't understand that. Please choose an option from the list.";
    }
};

const handleFeedbackOption = async (from, body) => {
    const options = {
        '1': "What made it hard to accomplish the task? We’d love to understand better and support you.",
        '2': "Do you think the task wasn't relevant to you? We value your input and want to tailor the suggestions better.",
        '3': "If you don't feel like it, that's completely okay. We all have days when we're not in the mood. Remember, there will always be another opportunity."
    };

    const selectedOption = options[body];
    if (selectedOption) {
        userState[from].status = 'waitingForFeedback';
        userFeedback[from] = selectedOption;
        await sendMessage(from, selectedOption);
        return '';
    } else {
        return "Sorry, I didn't understand that. Please choose an option from the list.";
    }
};

const handleFeedback = async (from, body) => {
    // Process feedback
    userState[from].status = 'initial';
    await sendMessage(from, "Thank you for your feedback. We appreciate it and will use it to improve.");
    return '';
};

const ifActDone = async (from, name) => {
    userState[from].status = `postActMeasures_${Date.now()}`;
    await sendMessage(from, `That’s great to hear, ${name}! Would you mind answering some questions to help us better understand how you felt after doing the act? Please text “Yes” or “No”.`);
    return '';
};

const handlePostActMeasures = async (from, body) => {
    if (/^(yes|y)$/i.test(body)) {
        userState[from].status = 'initial';
        await sendMessage(from, "Thank you! Please answer the following questions on a scale of 1-5, where 1 is the lowest and 5 is the highest:");
        // Add your questions here
        return '';
    } else if (/^(no|n)$/i.test(body)) {
        userState[from].status = 'initial';
        await sendMessage(from, "No worries! Thank you for your time. If you have any other feedback or need support, let us know.");
        return '';
    } else {
        return "Sorry, I didn't understand that. Please respond with 'Yes' or 'No'.";
    }
};

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

module.exports = app;
