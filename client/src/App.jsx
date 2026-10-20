import { useEffect, useRef, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';

async function api(path, { token, body, ...options } = {}) {
  const headers = { ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function formatTime(seconds) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('jumptothis-token') || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(Boolean(token));
  const [file, setFile] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState([]);
  const [video, setVideo] = useState(null);
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState('keyword');
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState([]);
  const [activeResult, setActiveResult] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteTimestamp, setNoteTimestamp] = useState(null);
  const [error, setError] = useState('');
  const playerRef = useRef(null);

  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      return undefined;
    }
    let cancelled = false;
    api('/api/auth/me', { token })
      .then((account) => {
        if (!cancelled) setUser(account);
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem('jumptothis-token');
          setToken('');
        }
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !user) return undefined;
    let cancelled = false;
    api('/api/videos', { token })
      .then(({ videos }) => {
        if (!cancelled) setLibrary(videos);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  useEffect(() => {
    if (
      !token ||
      !video ||
      (!['queued', 'processing'].includes(video.status) && video.embeddingStatus !== 'processing')
    ) return undefined;
    let cancelled = false;
    let timer;
    const checkStatus = async () => {
      try {
        let updatedVideo = await api(`/api/videos/${video.id}`, { token });
        if (!cancelled) {
          if (updatedVideo.status === 'completed' && !video.fileUrl?.includes('?access=')) {
            const playback = await api(`/api/videos/${video.id}/playback`, { token });
            updatedVideo = { ...updatedVideo, fileUrl: playback.fileUrl };
          }
          if (cancelled) return;
          setVideo(updatedVideo);
          if (
            ['completed', 'failed'].includes(updatedVideo.status) &&
            updatedVideo.embeddingStatus !== 'processing'
          ) {
            const { videos } = await api('/api/videos', { token });
            setLibrary(videos);
          }
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError.message);
      }
      if (!cancelled) timer = setTimeout(checkStatus, 3000);
    };
    timer = setTimeout(checkStatus, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, video?.id, video?.status, video?.embeddingStatus, video?.fileUrl]);

  async function submitAuth(event) {
    event.preventDefault();
    setError('');
    setAuthLoading(true);
    try {
      const action = authMode === 'register' ? 'register' : 'login';
      const data = await api(`/api/auth/${action}`, {
        method: 'POST',
        body: { email, password },
      });
      localStorage.setItem('jumptothis-token', data.token);
      setToken(data.token);
      setUser(data.user);
      setPassword('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function signOut() {
    localStorage.removeItem('jumptothis-token');
    setToken('');
    setUser(null);
    setLibrary([]);
    setVideo(null);
    setResults([]);
    setError('');
  }

  async function uploadVideo(event) {
    event.preventDefault();
    if (!file || !hasPermission) return;
    setError('');
    setVideo(null);
    setResults([]);
    setQuery('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('video', file);
      const uploadedVideo = await api('/api/videos', {
        token,
        method: 'POST',
        body: formData,
      });
      setVideo(uploadedVideo);
      setFile(null);
      const { videos } = await api('/api/videos', { token });
      setLibrary(videos);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUploading(false);
    }
  }

  async function openVideo(videoId) {
    setError('');
    setResults([]);
    setActiveResult(-1);
    setNoteTimestamp(null);
    try {
      let selected = await api(`/api/videos/${videoId}`, { token });
      if (selected.status === 'completed') {
        const playback = await api(`/api/videos/${videoId}/playback`, { token });
        selected = { ...selected, fileUrl: playback.fileUrl };
      }
      setVideo(selected);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function searchVideo(event) {
    event.preventDefault();
    if (!video || !query.trim()) return;
    setError('');
    setResults([]);
    setActiveResult(-1);
    setSearching(true);
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        mode: searchMode,
        wholeWord: String(searchMode === 'keyword' && wholeWord),
      });
      const data = await api(`/api/videos/${video.id}/search?${params}`, { token });
      setResults(data.results);
      if (!data.results.length) setError('No matching moments found.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSearching(false);
    }
  }

  async function indexForSemanticSearch() {
    if (!video) return;
    setError('');
    try {
      await api(`/api/videos/${video.id}/semantic-index`, { token, method: 'POST' });
      setVideo((current) => ({ ...current, embeddingStatus: 'processing', embeddingError: '' }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function jumpTo(seconds, resultIndex = -1) {
    if (!playerRef.current) return;
    playerRef.current.currentTime = seconds;
    playerRef.current.play().catch((playError) => setError(playError.message));
    setActiveResult(resultIndex);
  }

  function selectResultNote(seconds) {
    setNoteTimestamp(seconds);
    setError('');
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!video || !noteText.trim()) return;
    const timestamp = noteTimestamp ?? playerRef.current?.currentTime;
    if (!Number.isFinite(timestamp)) {
      setError('Choose a result timestamp or start playing the video first.');
      return;
    }
    try {
      const { note } = await api(`/api/videos/${video.id}/notes`, {
        token,
        method: 'POST',
        body: { text: noteText.trim(), timestamp },
      });
      setVideo((current) => ({ ...current, notes: [...current.notes, note] }));
      setNoteText('');
      setNoteTimestamp(null);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteNote(noteId) {
    try {
      const data = await api(`/api/videos/${video.id}/notes/${noteId}`, {
        token,
        method: 'DELETE',
      });
      setVideo((current) => ({ ...current, notes: data.notes }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function moveResult(direction) {
    if (!results.length) return;
    const next = activeResult < 0
      ? (direction > 0 ? 0 : results.length - 1)
      : (activeResult + direction + results.length) % results.length;
    jumpTo(results[next].start, next);
  }

  if (authLoading) {
    return <main className="page"><p className="status">Checking your account…</p></main>;
  }

  if (!user) {
    return (
      <main className="page">
        <header className="site-header">
          <a className="brand" href="/">video-search<span>.</span></a>
          <p>Your videos, private to your account.</p>
        </header>
        <section className="panel auth-panel">
          <h1>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <form onSubmit={submitAuth}>
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={authMode === 'register' ? 10 : undefined} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} /></label>
            {authMode === 'register' && <small>Use at least 10 characters.</small>}
            <button className="primary-button" disabled={authLoading}>{authMode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="link-button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); }}>
            {authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  const isProcessing = video && ['queued', 'processing'].includes(video.status);

  return (
    <main className="page">
      <header className="site-header">
        <a className="brand" href="/">video-search<span>.</span></a>
        <div className="account-bar"><span>{user.email}</span><button className="link-button" onClick={signOut}>Sign out</button></div>
      </header>

      <section className="intro">
        <p className="eyebrow">VIDEO SEARCH</p>
        <h1>Skip straight to <span>what you need.</span></h1>
        <p>Upload a video, search its transcript, and jump right to the moment.</p>
      </section>

      <section className="panel upload-panel">
        <h2>1. Add a video</h2>
        <form onSubmit={uploadVideo}>
          <label className="file-picker">
            <span>{file ? file.name : 'Choose a video file'}</span>
            <input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label>
          <label className="permission">
            <input type="checkbox" checked={hasPermission} onChange={(event) => setHasPermission(event.target.checked)} />
            I have permission to upload and process this video.
          </label>
          <button className="primary-button" disabled={!file || !hasPermission || uploading}>
            {uploading ? 'Uploading…' : 'Upload and transcribe'}
          </button>
        </form>
        {uploading && <p className="status" role="status">Uploading your video…</p>}
        {isProcessing && <p className="status" role="status">{video.status === 'queued' ? 'Video accepted. Preparing transcription…' : 'Transcribing video. This can take a while…'}</p>}
        {video?.status === 'failed' && <p className="error" role="alert">Transcription failed: {video.error}</p>}
        {video?.status === 'completed' && <p className="success" role="status">Transcription complete. Search or add notes below.</p>}
        {video?.embeddingStatus === 'processing' && <p className="status" role="status">Preparing semantic search with the local embedding model…</p>}
        {video?.embeddingStatus === 'failed' && <p className="error" role="alert">Semantic indexing failed: {video.embeddingError}</p>}
      </section>

      <section className="library-layout">
        <section className="panel library-panel">
          <h2>Your video library</h2>
          {library.length ? (
            <ul className="library-list">
              {library.map((item) => (
                <li key={item.id}>
                  <button className={video?.id === item.id ? 'library-item selected' : 'library-item'} onClick={() => openVideo(item.id)}>
                    <span>{item.originalName}</span><small>{item.status}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="empty-state">Your uploaded videos will appear here.</p>}
        </section>

        {video?.status === 'completed' && (
          <section className="workspace">
            <section className="panel video-panel">
              <h2>2. Search {video.originalName}</h2>
              <video
                ref={playerRef}
                controls
                preload="metadata"
                src={`${API_URL}${video.fileUrl}`}
                onError={() => setError('The video could not be loaded. Reopen it from your library and try again.')}
              />
              <form className="search-form" onSubmit={searchVideo}>
                <label htmlFor="search-query">Search transcript</label>
                <div className="search-row">
                  <input id="search-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try a word or phrase" />
                  <button className="primary-button" disabled={!query.trim() || searching}>{searching ? 'Searching…' : 'Search'}</button>
                </div>
                <div className="search-options">
                  <label className="search-mode">
                    Search type
                    <select value={searchMode} onChange={(event) => setSearchMode(event.target.value)}>
                      <option value="keyword">Keyword</option>
                      <option value="semantic">Semantic meaning</option>
                    </select>
                  </label>
                  {searchMode === 'keyword' ? (
                    <label className="permission whole-word">
                      <input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} />
                      Match whole words only
                    </label>
                  ) : video.embeddingStatus === 'pending' || video.embeddingStatus === 'failed' ? (
                    <button type="button" className="secondary-button" onClick={indexForSemanticSearch}>
                      {video.embeddingStatus === 'failed' ? 'Retry semantic indexing' : 'Prepare semantic search'}
                    </button>
                  ) : video.embeddingStatus === 'processing' ? (
                    <span className="status">Preparing semantic search…</span>
                  ) : null}
                </div>
              </form>
              <section className="notes-section">
                <h3>Notes</h3>
                <p className="empty-state">
                  {noteTimestamp === null ? 'Note time: current player position' : `Note time: ${formatTime(noteTimestamp)}`}
                </p>
                <form className="note-form" onSubmit={saveNote}>
                  <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} maxLength={1000} placeholder="Write a note for this moment…" required />
                  <div className="note-actions">
                    <button type="button" className="secondary-button" onClick={() => setNoteTimestamp(playerRef.current?.currentTime ?? 0)}>
                      Use current time
                    </button>
                    <button className="primary-button" disabled={!noteText.trim()}>Save note</button>
                  </div>
                </form>
                {video.notes?.length ? (
                  <ul className="notes-list">
                    {video.notes.map((note) => (
                      <li key={note.id}>
                        <button className="timestamp" onClick={() => jumpTo(note.timestamp)}>{formatTime(note.timestamp)}</button>
                        <span>{note.text}</span>
                        <button className="link-button" onClick={() => deleteNote(note.id)}>Delete</button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="empty-state">No notes yet.</p>}
              </section>
            </section>
            <section className="panel results-panel">
              <h2>Matching moments</h2>
              <p className="result-count" aria-live="polite">{results.length} {results.length === 1 ? 'match' : 'matches'}</p>
              <div className="result-navigation">
                <button className="secondary-button" disabled={!results.length} onClick={() => moveResult(-1)}>Previous</button>
                <span>{results.length && activeResult >= 0 ? `${activeResult + 1} / ${results.length}` : '—'}</span>
                <button className="secondary-button" disabled={!results.length} onClick={() => moveResult(1)}>Next</button>
              </div>
              {results.length ? (
                <ul className="results">
                  {results.map((result, index) => (
                    <li key={`${result.start}-${result.text}`}>
                      <div className={activeResult === index ? 'result active-result' : 'result'}>
                        <button className="result-jump" onClick={() => jumpTo(result.start, index)}>
                          <span className="timestamp">{formatTime(result.start)}</span><span>{result.text}</span>
                        </button>
                        <button className="link-button" onClick={() => selectResultNote(result.start)}>Add note here</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="empty-state">{searching ? 'Searching transcript…' : 'Search a word or phrase to find its moments.'}</p>}
            </section>
          </section>
        )}
      </section>
      {error && <p className="error page-error" role="alert">{error}</p>}
      <footer>Videos, transcripts, and notes are private to your account.</footer>
    </main>
  );
}
