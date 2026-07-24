import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const API_BASE = 'https://repo-chat-ckig.onrender.com';

const SAMPLE_PROMPTS = [
  'How is authentication handled?',
  'Where are routes defined?',
  'How is the database connected?',
];

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoId, setRepoId] = useState(null);
  const [repoLabel, setRepoLabel] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState('');

  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function handleIngest() {
    if (!repoUrl.trim() || ingesting) return;
    setIngesting(true);
    setIngestError('');

    try {
      const res = await fetch(`${API_BASE}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to load repo');

      setRepoId(data.repoId);
      setRepoLabel(repoUrl.trim().split('/').slice(-2).join('/'));
      setMessages([]);
    } catch (err) {
      setIngestError(err.message);
    } finally {
      setIngesting(false);
    }
  }

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text || loading || !repoId) return;

    setMessages(prev => [...prev, { role: 'user', text }]);
    setQuestion('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, repoId }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.answer, sources: data.sources }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Could not reach the server.', isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e, action) {
    if (e.key === 'Enter') action();
  }

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <span className="prompt-glyph">$</span>
          <span className="brand-text">repo-chat</span>
          <span className="cursor" aria-hidden="true">▍</span>
        </div>
        <p className="subtitle">// ask any public repo a question, get a real answer</p>
      </header>

      {!repoId ? (
        <div className="ingest-panel">
          <label className="ingest-label">GitHub repository URL</label>
          <div className="input-bar">
            <span className="input-glyph">git</span>
            <input
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              onKeyDown={e => handleKeyDown(e, handleIngest)}
              placeholder="https://github.com/user/repo"
              disabled={ingesting}
            />
            <button onClick={handleIngest} disabled={ingesting || !repoUrl.trim()}>
              {ingesting ? 'Loading...' : 'Load'}
            </button>
          </div>
          {ingesting && (
            <p className="ingest-hint">Cloning and indexing the repo — this can take 30-90s depending on size.</p>
          )}
          {ingestError && <p className="ingest-error">⚠ {ingestError}</p>}
        </div>
      ) : (
        <>
          <div className="repo-banner">
            📂 <span>{repoLabel}</span>
            <button className="switch-repo" onClick={() => { setRepoId(null); setRepoUrl(''); setMessages([]); }}>
              switch repo
            </button>
          </div>

          <div className="chat-window">
            {messages.length === 0 && (
              <div className="empty-state">
                <p className="empty-title">no messages yet</p>
                <div className="samples">
                  {SAMPLE_PROMPTS.map((p, i) => (
                    <button key={i} className="sample-chip" onClick={() => ask(p)}>{p}</button>
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
              onKeyDown={e => handleKeyDown(e, () => ask())}
              placeholder="ask something about your codebase..."
              disabled={loading}
            />
            <button onClick={() => ask()} disabled={loading || !question.trim()}>Run</button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;