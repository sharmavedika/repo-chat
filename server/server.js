require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { glob } = require('glob');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Pick any embedding + chat model OpenRouter supports.
// Swap these strings any time without touching the rest of the code.
// Both set to free models below — swap EMBEDDING_MODEL back to a paid one
// (e.g. 'openai/text-embedding-3-small') if you want higher quality retrieval.
const EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b:free';
const CHAT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

// In-memory store: { repoId: [ { file, text, embedding }, ... ] }
const repoStore = {};

const CODE_EXTENSIONS = 'js,jsx,ts,tsx,py,java,go,rb,php,ejs,html,css,md,ipynb';
const MAX_CHUNKS = 150; // safety cap so huge repos don't take forever
const EMBED_BATCH_SIZE = 20; // chunks per embeddings request

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

// Generic fetch-with-retry for OpenRouter. Retries on 429s and 5xxs
// with exponential backoff, and throws a clean Error otherwise.
async function openRouterFetch(endpoint, body, { retries = 4 } = {}) {
  let attempt = 0;
  let lastErr;

  while (attempt < retries) {
    attempt++;
    try {
      const res = await fetch(`${OPENROUTER_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          // Optional but recommended by OpenRouter for attribution/rankings
          'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://repo-chat.example',
          'X-Title': 'repo-chat',
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        lastErr = new Error(`OpenRouter ${res.status}: ${text}`);
        if (attempt < retries) {
          const waitMs = 500 * Math.pow(2, attempt - 1); // 500ms, 1s, 2s, 4s...
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw lastErr;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${text}`);
      }

      return res.json();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) throw err;
      const waitMs = 500 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  throw lastErr;
}

// Embed a batch of strings in a single request.
async function embedBatch(texts) {
  const data = await openRouterFetch('/embeddings', {
    model: EMBEDDING_MODEL,
    input: texts,
  });
  // OpenAI-shaped response: data.data is an array in the same order as input
  return data.data.map((d) => d.embedding);
}

async function embedText(text) {
  const [embedding] = await embedBatch([text]);
  return embedding;
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

  // 3. Collect all chunks (with their source file) up to the safety cap
  const pending = [];
  outer:
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const fileChunks = chunkFile(content);

    for (const chunk of fileChunks) {
      if (chunk.trim().length === 0) continue;
      if (pending.length >= MAX_CHUNKS) break outer;

      pending.push({ file: path.relative(tmpDir, file), text: chunk });
    }
  }

  // 4. Embed in batches instead of one call per chunk.
  //    This is the main fix for the 429 rate-limit crashes.
  const chunks = [];
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((b) => b.text));
    batch.forEach((b, idx) => {
      chunks.push({ ...b, embedding: embeddings[idx] });
    });
  }

  // 5. Store in memory, clean up disk
  repoStore[repoId] = chunks;
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { repoId, fileCount: files.length, chunkCount: chunks.length };
}

async function search(repoId, question, topK = 3) {
  const chunks = repoStore[repoId];
  if (!chunks) throw new Error('Repo not found. Please ingest it first.');

  const questionEmbedding = await embedText(question);
  const scored = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(questionEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function askQuestion(repoId, question) {
  const results = await search(repoId, question);
  const context = results.map((r) => `File: ${r.file}\n${r.text}`).join('\n\n---\n\n');

  const prompt = `You are a helpful assistant answering questions about a codebase.
Use ONLY the code context below to answer. If the answer isn't in the context, say so clearly.

CONTEXT:
${context}

QUESTION: ${question}

ANSWER:`;

  const data = await openRouterFetch('/chat/completions', {
    model: CHAT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  const answer = data.choices?.[0]?.message?.content ?? '(no answer returned)';
  return { answer, sources: results.map((r) => r.file) };
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
    const isRateLimit = /429|rate limit/i.test(err.message || '');
    res.status(isRateLimit ? 429 : 500).json({
      error: isRateLimit
        ? 'Hit a rate limit while embedding this repo. Please try again in a moment.'
        : (err.message || 'Failed to ingest repo'),
    });
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
    const isRateLimit = /429|rate limit/i.test(err.message || '');
    res.status(isRateLimit ? 429 : 500).json({
      error: isRateLimit
        ? 'Hit a rate limit answering that question. Please try again in a moment.'
        : (err.message || 'Something went wrong'),
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));