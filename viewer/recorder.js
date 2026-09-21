(() => {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:16px;left:16px;z-index:9999;background:#111e;color:#eef;padding:16px;border-radius:12px;font:14px system-ui;width:360px;max-width:calc(100vw - 64px);max-height:calc(100vh - 64px);overflow:auto;box-shadow:0 4px 24px #0008';
  panel.innerHTML = '<b>Jev · Live first-person view</b><p id="state">Connecting…</p><details open><summary>Inventory & equipment</summary><p id="inventory"></p></details><details open><summary>Goal & planner</summary><p id="goal"></p></details><details><summary>Recent actions</summary><p id="recent"></p></details><button id="record">Record POV</button> <button id="save" disabled>Stop & download</button><p id="record-status">Records this view, without audio. Keep this tab open.</p><small>26.1 world rendered with 1.21.4 assets; newer blocks may look different.</small>';
  document.body.append(panel);
  const button = panel.querySelector('#record');
  const save = panel.querySelector('#save');
  const status = panel.querySelector('#record-status');
  let recorder, stream, timer, segment = 0, chunks = [], recording = false;
  function startSegment() {
    chunks = [];
    const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 4000000 } : {});
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `jev-pov-${new Date().toISOString().replaceAll(':','-')}-${++segment}.${recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      link.textContent = `Download recording segment ${segment}`;
      link.style.cssText = 'display:block;color:#9df;margin-top:8px';
      panel.append(link); link.click();
      // Bound memory for long runs with independent five-minute recordings.
      setTimeout(() => URL.revokeObjectURL(link.href), 600000);
      if (recording) startSegment();
      else { stream.getTracks().forEach(track => track.stop()); status.textContent = 'Recording saved. Download links stay available for ten minutes.'; }
    };
    recorder.start(1000);
    timer = setTimeout(() => recorder.stop(), 300000);
  }
  button.onclick = () => {
    try {
      const canvas = document.querySelector('canvas');
      if (!canvas?.captureStream || !window.MediaRecorder) throw new Error('Use a browser with canvas recording support, such as Chrome.');
      stream = canvas.captureStream(30); recording = true; startSegment();
      button.disabled = true; save.disabled = false;
      status.textContent = 'Recording at 30 fps. Five-minute segments download automatically; allow multiple downloads.';
    } catch (error) { status.textContent = error.message; recording = false; }
  };
  save.onclick = () => { recording = false; clearTimeout(timer); if (recorder?.state === 'recording') recorder.stop(); button.disabled = false; save.disabled = true; };
  window.addEventListener('beforeunload', event => { if (recording) { event.preventDefault(); event.returnValue = ''; } });
  let dimension, polling = false;
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const data = await (await fetch('/state', {cache:'no-store'})).json();
      const s = data.current;
      if (!s) return;
      if (dimension && dimension !== s.dimension) {
        if (recording) save.click();
        panel.querySelector('#state').textContent = 'Dimension changed. Recording stopped. Reload to view the new dimension.';
        return;
      }
      dimension = s.dimension;
      const lines = (id, text) => { const node = panel.querySelector(id); node.textContent = text; node.style.whiteSpace = 'pre-line'; };
      const p = s.position;
      lines('#state', `Health ${s.health?.toFixed(1)}/20 · Food ${s.food}/20 · ${s.dimension}\n${p ? `XYZ ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : ''}\n${s.objective}\n${data.activeAction?.phase === 'settling' ? 'Waiting for state updates: ' : ''}${data.activeAction?.description || 'Choosing next action…'}`);
      lines('#inventory', `${Object.entries(s.inventory || {}).sort(([a],[b]) => a.localeCompare(b)).map(([name,count]) => `${name} × ${count}`).join('\n') || 'Empty'}\n\nHeld: ${s.heldItem || 'nothing'}\nArmor: ${(s.equipped || []).join(', ') || 'none'}`);
      const plan = data.plan;
      const status = plan?.status === 'completed' ? 'Completed (verified)' : plan?.acknowledgement?.status === 'pursuing' ? 'Established by Jev' : plan?.acknowledgement?.status || 'Proposed; awaiting Jev';
      lines('#goal', `${plan?.description || 'Jev is choosing its own next steps'}\n${plan ? status : 'No advisory goal'}\nAdvisor: ${data.planner?.pending ? 'thinking in background' : 'idle'}\n${plan?.rationale || ''}\n${(plan?.steps || []).map((step,i) => `${i+1}. ${step}`).join('\n')}\n${(data.completion || []).map(c => `${c.satisfied ? '✓' : '○'} ${c.key}${c.target ? ` × ${c.target}` : ''}`).join('\n')}`);
      lines('#recent', [...(data.recent || [])].reverse().map(a => `${a.result} · ${a.description || a.action} (${Math.round((a.confidence || 0)*100)}%)${a.error ? `\n${a.error}` : ''}\n${Object.entries(a.inventoryDelta || {}).map(([name,n]) => `${name} ${n>0?'+':''}${n}`).join(', ')}`).join('\n\n') || 'No completed actions yet');
    } catch {
      panel.querySelector('#state').textContent = 'Bot disconnected. You can stop and download the recording.';
    } finally { polling = false; }
  }, 250);
})();
