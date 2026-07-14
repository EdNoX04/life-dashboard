import React from 'react';

// Catches render errors in a tab so one glitch can't blank the whole app.
export default class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[PlayerOne tab error]', err, info); }
  render() {
    if (this.state.err) {
      return (
        <div className="px card" style={{ marginTop: 20 }}>
          <div className="card-title" style={{ color: 'var(--red)' }}><span className="sq" style={{ background: 'var(--red)' }} />Something glitched on this screen</div>
          <div className="small" style={{ color: 'var(--ink-2)' }}>The rest of PLAYER ONE is fine — this tab hit an error. Try again, or switch tabs and come back.</div>
          <pre className="small muted" style={{ whiteSpace: 'pre-wrap', marginTop: 10, maxHeight: 120, overflow: 'auto' }}>{String(this.state.err?.message || this.state.err)}</pre>
          <button className="btn btn-pink mt" onClick={() => this.setState({ err: null })}>↻ Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
