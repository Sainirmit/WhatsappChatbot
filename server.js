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
    if (!userInteractions[from]) {
        userInteractions[from] = true; // Mark the user as having interacted
        responseMessage = await sendFirstInteractionMessage(from);
    } else if (/^(hello|hi|hey|hi\schat|Hello|Hi)$/i.test(body)) {
        responseMessage = await startInteraction(from);
    } else if (userState[from] === 'initial') {
        if (body === 'done') {
            responseMessage = await ifActDone(from);
        } else if (body === 'not yet') {
            responseMessage = "No problem! Don’t worry about it. We’re not always in the mood. Tomorrow is another day and you’ll have another opportunity to spread kindness to yourself or others.😊";
        } else {
            responseMessage = "Sorry, I didn't understand that.";
        }
    } else if (userState[from] === 'waitingForOptionAfter9Hours') {
        if (body === 'done') {
            responseMessage = await ifActDone(from);
        } else if (body === 'not yet') {
            responseMessage = await sendOptions(from);
            userState[from] = 'waitingForOptionSelection';
        } else {
            responseMessage = "Sorry, I didn't understand that.";
        }
    } else if (userState[from] === 'waitingForOptionSelection') {
        responseMessage = await handleTaskSelection(from, body);
    } else if (userState[from] === 'waitingForFeedbackOption') {
        responseMessage = await handleFeedbackOption(from, body);
    } else if (userState[from] === 'waitingForFeedback') {
        responseMessage = await handleFeedback(from, body);
    } else if (userState[from] === 'waitingForCompletion') {
        if (body === 'done') {
            responseMessage = await ifActDone(from);
        } else if (body === 'not yet') {
            responseMessage = "No problem! Don’t worry about it. We’re not always in the mood. Tomorrow is another day and you’ll have another opportunity to spread kindness to yourself or others.😊";
        } else {
            responseMessage = "Sorry, I didn't understand that.";
        }
    } else if (userState[from] && userState[from].startsWith('postActMeasures')) {
        responseMessage = await handlePostActMeasures(from, body);
    } else {
        responseMessage = "Please start the conversation by saying 'Hello'.";
    }

    if (responseMessage) {
        await sendMessage(from, responseMessage);
    }

    res.status(200).end();
});

const sendFirstInteractionMessage = async (to) => {
    userState[to] = 'initial';
    const message = `Thanks again for sharing all that information about you, {Name}. It sounds like you had a difficult year so before caring for others, we’d like you first to focus on yourself. Kindness to oneself is just as important. Please take some time for you today with this small act: [add low effort self-care act]. Once you do, please let us know by texting “done”. Take care of yourself today!`;
    await sendMessage(to, message);
    setReminder(to, 6 * 1000, "Hey {Name}, don’t forget to care for yourself today with our suggested act. Or with anything else that might bring you a smile. Just take a moment today to care for you. It’s as important as caring for others. ❤️");
    setReminder(to, 9 * 1000, "Hi {Name}, just checking if you took a moment to do something nice for you . Please respond “Done” or “Not Yet”. Thank you for being part of this journey!❤️", 'waitingForOptionAfter9Hours');
    return '';
};

const startInteraction = async (to) => {
    userState[to] = 'initial';
    const message = `Thanks again for sharing all that information about you, {Name}. It sounds like you had a difficult year so before caring for others, we’d like you first to focus on yourself. Kindness to oneself is just as important. Please take some time for you today with this small act: [add low effort self-care act]. Once you do, please let us know by texting “done”. Take care of yourself today!`;
    await sendMessage(to, message);
    setReminder(to, 6 * 1000, "Hey {Name}, don’t forget to care for yourself today with our suggested act. Or with anything else that might bring you a smile. Just take a moment today to care for you. It’s as important as caring for others. ❤️");
    setReminder(to, 9 * 1000, "Hi {Name}, just checking if you took a moment to do something nice for you . Please respond “Done” or “Not Yet”. Thank you for being part of this journey!❤️", 'waitingForOptionAfter9Hours');
    return '';
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
            to: 'whatsapp:+919878417442', // The user's WhatsApp number
            body: text
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
        '3': "Sorry to hear that. When we make a suggestion, you can always ask for an alternative act. Maybe this is more to your liking? [add new, low effort self-care act]. Or choose your own way to care for yourself today. What matters is to give yourself permission to indulge, even if it’s just for a few moments. You deserve it! 🌟 Don’t forget to tell us you’ve completed it by sending “Done”.",
        '4': "Thanks for letting us know. Please don’t forget to tell us when you’ve completed it by sending “Done”. Indulge yourself today. You deserve it!🌟",
        '5': "Would you be so kind to share your valuable feedback with us?\n1. Yes, I would love to\n2. No, Thank you",
    };

    const selectedOption = options[body];

    if (selectedOption) {
        if (body === '5') {
            userState[from] = 'waitingForFeedbackOption';
        }
        return selectedOption;
    } else {
        await sendMessage(from, "Invalid option. Please type a number 1 to 5.");
        return await sendOptions(from);
    }
};

const handleFeedbackOption = async (from, body) => {
    if (body === '1' || body === 'yes, i would love to') {
        userState[from] = 'waitingForFeedback';
        return "We are so glad you decided to share your valuable feedback with us! Please go ahead and tell us how we can improve!";
    } else if (body === '2' || body === 'no, thank you') {
        userState[from] = 'waitingForCompletion';
        return "Thanks for your feedback. There are many reasons why an act might not work out. Remember, when we make a suggestion, you can always ask for an alternative act.";
    } else {
        return "Invalid option. Please choose 1 for Yes or 2 for No.";
    }
};

const handleFeedback = async (from, body) => {
    userState[from] = 'waitingForCompletion';
    return "Thank you for sharing your specific concern. We’ll take this into account for future suggestions. Remember, when we make a suggestion, you can always ask for an alternative act.";
};

const ifActDone = async (to) => {
    userState[to] = 'postActMeasures1';
    clearReminders(to);
    await sendMessage(to, "So happy to hear you took time to care for yourself, {Name}. We hope it made you feel better. Keep it up! 🌟");
    await sendMessage(to, "How are you feeling right now?\n😇 - On cloud nine\n😃 - Happy\n🙂 - Satisfied\n😒 - I could be better\n😡 - Not satisfied at all");
    return '';
};

const handlePostActMeasures = async (from, body) => {
    if (userState[from] === 'postActMeasures1') {
        userFeedback[from] = { feeling: body };
        userState[from] = 'postActMeasures2';
        return "And how meaningful do you find your life (activities, relationships, personal goals) right now?\n0: No sense of meaning.\n10: Extremely high sense of meaning.";
    } else if (userState[from] === 'postActMeasures2') {
        const rating = parseInt(body);
        if (isNaN(rating) || rating < 0 || rating > 10) {
            return "Please provide a number from 0 to 10.";
        }
        userFeedback[from].meaning = rating;
        userState[from] = 'postActMeasures3';
        return "How lonely do you feel right now?\n0: Not lonely at all.\n10: Extremely lonely.";
    } else if (userState[from] === 'postActMeasures3') {
        const rating = parseInt(body);
        if (isNaN(rating) || rating < 0 || rating > 10) {
            return "Please provide a number from 0 to 10.";
        }
        userFeedback[from].loneliness = rating;
        userState[from] = 'postActMeasures4';
        return "Finally, with the self-care act you just performed in mind, please tell us how true each statement is for you.\n1-Not at all true\n2-Not true\n3-I’m not sure\n4-True\n5-Very true\nWhen you are ready to continue, let us know by sending us a 👍";
    } else if (userState[from] === 'postActMeasures4' && body === '👍') {
        userState[from] = 'postActMeasures5';
        return "Great now answer the following questions 😊\nI felt pressure to do it.\n(Please choose an option from 1 - 5)";
    } else if (userState[from] === 'postActMeasures5') {
        return await handlePostActQuestions(from, body, 'pressure', 'postActMeasures6', "It helped me connect with my feelings.\n(Please choose an option from 1 - 5)");
    } else if (userState[from] === 'postActMeasures6') {
        return await handlePostActQuestions(from, body, 'feelings', 'postActMeasures7', "It made me feel more competent as a person.\n(Please choose an option from 1 - 5)");
    } else if (userState[from] === 'postActMeasures7') {
        return await handlePostActQuestions(from, body, 'competent', 'postActMeasures8', "Doing it was entirely my decision.\n(Please choose an option from 1 - 5)");
    } else if (userState[from] === 'postActMeasures8') {
        return await handlePostActQuestions(from, body, 'decision', 'postActMeasures9', "It made me feel relaxed and at-ease.\n(Please choose an option from 1 - 5)");
    } else if (userState[from] === 'postActMeasures9') {
        return await handlePostActQuestions(from, body, 'relaxed', 'postActMeasures10', "I felt a sense of accomplishment after performing it.\n(Please choose an option from 1 - 5)");
    } else if (userState[from] === 'postActMeasures10') {
        return await handlePostActQuestions(from, body, 'accomplishment', 'completed', null);
    }
};

const handlePostActQuestions = async (from, body, key, nextState, nextMessage) => {
    const rating = parseInt(body);
    if (isNaN(rating) || rating < 1 || rating > 5) {
        return "Please provide a number from 1 to 5.";
    }
    userFeedback[from][key] = rating;
    userState[from] = nextState;

    if (nextMessage) {
        return nextMessage;
    } else {
        return calculateScores(from);
    }
};

const calculateScores = (from) => {
    const feedback = userFeedback[from];
    const autonomySatisfaction = (6 - feedback.pressure + feedback.decision) / 2;
    const competenceSatisfaction = (feedback.competent + feedback.accomplishment) / 2;
    const relatednessSatisfaction = (feedback.feelings + feedback.relaxed) / 2;

    return `Thank you for sharing your ratings! We appreciate your feedback.\nMood: ${feedback.feeling}\nSense of Meaning: ${feedback.meaning}\nLoneliness: ${feedback.loneliness}\n\nScores:\nAutonomy Satisfaction: ${autonomySatisfaction.toFixed(2)}\nCompetence Satisfaction: ${competenceSatisfaction.toFixed(2)}\nRelatedness Satisfaction: ${relatednessSatisfaction.toFixed(2)}\nThank you for being part of this journey! ❤️`;
};

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
});
