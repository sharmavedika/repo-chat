require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedText(text) {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function search(question, topK = 3) {
  const chunks = JSON.parse(fs.readFileSync('embeddings.json', 'utf-8'));
  const questionEmbedding = await embedText(question);
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(questionEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function askQuestion(question, retries = 3) {
  const results = await search(question);
  const context = results.map(r => `File: ${r.file}\n${r.text}`).join('\n\n---\n\n');

  const prompt = `You are a helpful assistant answering questions about a codebase.
Use ONLY the code context below to answer. If the answer isn't in the context, say so clearly.

CONTEXT:
${context}

QUESTION: ${question}

ANSWER:`;

  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return { answer: result.response.text(), sources: results.map(r => r.file) };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(res => setTimeout(res, 2000));
    }
  }
}

// The endpoint our React app will call
app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    const result = await askQuestion(question);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));