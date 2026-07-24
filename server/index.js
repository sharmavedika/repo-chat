require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function main() {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

  const result = await model.generateContent('Hello, who are you?');
  const text = result.response.text();

  console.log('Gemini says:', text);
}

main();