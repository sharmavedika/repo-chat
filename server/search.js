require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Cosine similarity: measures how "similar" two number-lists are
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
  // Load our stored chunks + embeddings
  const chunks = JSON.parse(fs.readFileSync('embeddings.json', 'utf-8'));

  // Embed the question the same way we embedded the code
  const questionEmbedding = await embedText(question);

  // Score every chunk by similarity to the question
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(questionEmbedding, chunk.embedding),
  }));

  // Sort highest similarity first, keep top K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

async function askQuestion(question) {
  const results = await search(question);

  // Build context from the top matching chunks
  const context = results
    .map(r => `File: ${r.file}\n${r.text}`)
    .join('\n\n---\n\n');

  // Build the full prompt for Gemini
  const prompt = `You are a helpful assistant answering questions about a codebase.
Use ONLY the code context below to answer. If the answer isn't in the context, say so clearly.

CONTEXT:
${context}

QUESTION: ${question}

ANSWER:`;

  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function main() {
  const question = process.argv[2] || "How is authentication handled?";
  console.log(`Question: ${question}\n`);

  const answer = await askQuestion(question);
  console.log('Answer:\n' + answer);
}

main();