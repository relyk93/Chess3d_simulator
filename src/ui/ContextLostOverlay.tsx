/** Shown when the browser drops the WebGL context (spec section 10). The scene cannot render until it is restored or the page reloads. */
export function ContextLostOverlay() {
  return (
    <div className="context-lost" role="alert">
      <h2>Graphics context lost</h2>
      <div>The 3D view stopped responding. Reload the page to continue.</div>
      <button className="btn" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
