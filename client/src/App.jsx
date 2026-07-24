import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const SAMPLE_PROMPTS = [
  'How is authentication handled?',
  'Where are routes defined?',
  'How is the database connected?',
];

function App() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || loading) return;

    setMessages(prev => [...prev, { role: 'user', text }]);
    setQuestion('');
    setLoading(true);

    try {
      const res = await fetch('https://repo-chat-ckig.onrender.com/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.answer, sources: data.sources }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Could not reach the server. Is `node server.js` still running?', isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') ask();
  }

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="prompt-glyph">$</span>
          <span className="brand-text">repo-chat</span>
          <span className="cursor" aria-hidden="true">▍</span>
        </div>
        <p className="subtitle">// ask your codebase a question, get a real answer</p>
      </header>

      <div className="chat-window">
        {messages.length === 0 && (
          <div className="empty-state">
            <p className="empty-title">no messages yet</p>
            <div className="samples">
              {SAMPLE_PROMPTS.map((p, i) => (
                <button key={i} className="sample-chip" onClick={() => ask(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          msg.role === 'user' ? (
            <div key={i} className="row user">
              <div className="bubble user">{msg.text}</div>
            </div>
          ) : (
            <div key={i} className="row ai">
              <div className={`answer-card ${msg.isError ? 'error' : ''}`}>
                {msg.sources && (
                  <div className="tab-bar">
                    {msg.sources.map((s, j) => (
                      <span key={j} className="tab">{s.split(/[/\\]/).pop()}</span>
                    ))}
                  </div>
                )}
                <div className="answer-body">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              </div>
            </div>
          )
        ))}

        {loading && (
          <div className="row ai">
            <div className="answer-card">
              <div className="answer-body typing">
                <span className="dot"></span><span className="dot"></span><span className="dot"></span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="input-bar">
        <span className="input-glyph">›</span>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ask something about your codebase..."
          disabled={loading}
        />
        <button onClick={() => ask()} disabled={loading || !question.trim()}>
          Run
        </button>
      </div>
    </div>
  );
}

export default App;