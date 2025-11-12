const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const app = express();
app.use(cors());
app.use(bodyParser.json());
const PORT = process.env.PORT;
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', time: Date.now() });
});
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
app.post('/api/answer', async (req, res) => {
    const payload = req.body || {};
    const questions = Array.isArray(payload.questions)
        ? payload.questions
        : payload.question
            ? [payload]
            : [];
    if (!GEMINI_KEY || GEMINI_KEY === 'YOUR_API_KEY_HERE') {
        const results = questions.map(q => ({
            questionId: q.id || null,
            gemini: { ok: false, error: 'No GEMINI_KEY - fallback used' },
            answer: Array.isArray(q.options) && q.options.length ? q.options[0] : null,
            fallback: true,
        }));
        return res.json({ received: true, results });
    }
    const prompt = `You are given multiple multiple-choice questions in JSON format.
                    Respond with a JSON array containing objects with ONLY two keys: "id" and "answer".
                    The "id" must match the input question id exactly.
                    The "answer" must be exactly one of the provided options for that question.

                    Input questions:
                    ${JSON.stringify(questions, null, 2)}

                    Respond ONLY with a JSON array in this exact format:
                    [
                    {"id": "question_id_1", "answer": "option text"},
                    {"id": "question_id_2", "answer": "option text"}
                    ]

                    Do not include any explanations, markdown formatting, or extra text.`;

    const url = `${GEMINI_URL}?key=${encodeURIComponent(GEMINI_KEY)}`;
    const headers = { 'Content-Type': 'application/json' };
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 4096,
        },
    };
    try {
        const resp = await axios.post(url, body, { headers, timeout: 30000 });
        const candidates = resp.data?.candidates;
        let text = candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.trim().replace(/^```json\s*/m, '').replace(/```\s*$/m, '');
        let answersArray = null;
        try {
            answersArray = JSON.parse(text);
        } catch (err) {
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                try {
                    answersArray = JSON.parse(match[0]);
                } catch {
                    answersArray = null;
                }
            }
        }
        const results = [];
        if (Array.isArray(answersArray)) {
            for (const q of questions) {
                const geminiAnswer = answersArray.find(a => a.id === q.id);
                if (geminiAnswer && geminiAnswer.answer) {
                    results.push({
                        questionId: q.id,
                        gemini: { ok: true, parsed: geminiAnswer },
                        answer: geminiAnswer.answer,
                        fallback: false,
                    });
                } else {
                    results.push({
                        questionId: q.id,
                        gemini: { ok: false, error: 'No answer from Gemini for this question' },
                        answer: Array.isArray(q.options) && q.options.length ? q.options[0] : null,
                        fallback: true,
                    });
                }
            }
        } else {
            for (const q of questions) {
                results.push({
                    questionId: q.id,
                    gemini: { ok: false, error: 'Failed to parse Gemini response' },
                    answer: Array.isArray(q.options) && q.options.length ? q.options[0] : null,
                    fallback: true,
                });
            }
        }
        res.json({ received: true, results });
    } catch (err) {
        const results = questions.map(q => ({
            questionId: q.id || null,
            gemini: {
                ok: false,
                error: err.message,
                status: err.response?.status,
                data: err.response?.data,
            },
            answer: Array.isArray(q.options) && q.options.length ? q.options[0] : null,
            fallback: true,
        }));
        res.json({ received: true, results });
    }
});
app.get('/', (req, res) => res.send('GF helper server running'));
app.get('/health', (req, res) => res.send({ status: 'OK', time: Date.now() }));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
