// Pulls raw PCM off the mixed audio graph and posts it to the page.
//
// An AudioWorklet rather than the deprecated ScriptProcessor, and served as a
// FILE from this origin rather than built from a Blob URL — the app's CSP is
// `script-src 'self'`, and a worklet counts as a script, so a blob: worklet
// would be refused. Loosening the CSP to allow blob: scripts to save one file
// would trade a real protection for a small convenience.
class PCMTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    // A copy, not the view: the render quantum's buffer is reused on the very
    // next callback, so posting the view sends whatever comes after it instead.
    if (ch?.length) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('pcm-tap', PCMTap);
