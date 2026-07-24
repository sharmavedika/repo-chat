require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { glob } = require('glob');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory store: { repoId: [ { file, text, embedding }, ... ] }
const repoStore = {};

const CODE_EXTENSIONS = 'js,jsx,ts,tsx,py,java,go,rb,php,ejs,html,css,md';
const MAX_CHUNKS = 150; // safety cap so huge repos don't take forever on free tier

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function chunkFile(content, chunkSize = 40) {
  const lines = content.split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize).join('\n'));
  }
  return chunks;
}

async function embedText(text) {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

// Turn a GitHub URL into a stable, safe folder-name-friendly ID
function makeRepoId(repoUrl) {
  return crypto.createHash('md5').update(repoUrl).digest('hex').slice(0, 12);
}

async function ingestRepo(repoUrl) {
  const repoId = makeRepoId(repoUrl);
  const tmpDir = path.join('/tmp', `repo-${repoId}-${Date.now()}`);

  // 1. Clone the repo (shallow clone = only latest commit, much faster)
  const git = simpleGit();
  await git.clone(repoUrl, tmpDir, ['--depth', '1']);

  // 2. Find relevant code files
  const files = await glob(`${tmpDir}/**/*.{${CODE_EXTENSIONS}}`, {
    ignore: '**/node_modules/**',
  });

  const chunks = [];
  outer:
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const fileChunks = chunkFile(content);

    for (const chunk of fileChunks) {
      if (chunk.trim().length === 0) continue;
      if (chunks.length >= MAX_CHUNKS) break outer; // safety cap

      const embedding = await embedText(chunk);
      chunks.push({
        file: path.relative(tmpDir, file),
        text: chunk,
        embedding,
      });
    }
  }

  // 3. Store in memory, clean up disk
  repoStore[repoId] = chunks;
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { repoId, fileCount: files.length, chunkCount: chunks.length };
}

async function search(repoId, question, topK = 3) {
  const chunks = repoStore[repoId];
  if (!chunks) throw new Error('Repo not found. Please ingest it first.');

  const questionEmbedding = await embedText(question);
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(questionEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function askQuestion(repoId, question, retries = 3) {
  const results = await search(repoId, question);
  const context = results.map(r => `File: ${r.file}\n${r.text}`).join('\n\n---\n\n');

  const prompt = `You are a helpful assistant answering questions about a codebase.
Use ONLY the code context below to answer. If the answer isn't in the context, say so clearly.

CONTEXT:
${context}

QUESTION: ${question}

ANSWER:`;

  const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

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

// Ingest a new repo
app.post('/api/ingest', async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

    const result = await ingestRepo(repoUrl);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to ingest repo' });
  }
});

// Ask a question about an already-ingested repo
app.post('/api/ask', async (req, res) => {
  try {
    const { question, repoId } = req.body;
    if (!question || !repoId) return res.status(400).json({ error: 'question and repoId are required' });

    const result = await askQuestion(repoId, question);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));