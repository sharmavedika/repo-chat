require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { glob } = require('glob');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// CHANGE THIS to the path where you cloned Wanderlust
const REPO_PATH = 'C:/new/Error';

// Step A: Split a big file into smaller chunks (~40 lines each)
function chunkFile(content, chunkSize = 40) {
  const lines = content.split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize).join('\n'));
  }
  return chunks;
}

// Step B: Convert a chunk of text into an embedding (list of numbers)
async function embedChunk(text) {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent(text);
  return result.embedding.values; // this is the array of numbers
}

async function main() {
  // Find relevant code files, skip node_modules and hidden folders
  const files = await glob(`${REPO_PATH}/**/*.{js,ejs}`, {
    ignore: '**/node_modules/**',
  });

  console.log(`Found ${files.length} files. Starting ingestion...`);

  const allChunks = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const chunks = chunkFile(content);

    for (const chunk of chunks) {
      if (chunk.trim().length === 0) continue; // skip empty chunks

      console.log(`Embedding a chunk from: ${path.basename(file)}`);
      const embedding = await embedChunk(chunk);

      allChunks.push({
        file: file,
        text: chunk,
        embedding: embedding,
      });
    }
  }

  // Save everything to a local JSON file for now (our "database" for today)
  fs.writeFileSync('embeddings.json', JSON.stringify(allChunks, null, 2));
  console.log(`Done! Saved ${allChunks.length} chunks to embeddings.json`);
}

main();