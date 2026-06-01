return (async()=>{
  const d=document.createElement('div');
  d.id='trn-marker';
  d.textContent='trn-1780282159';
  document.body.appendChild(d);
  const t=document.createElement('span');
  t.id='trn-flash';
  t.textContent='FLASH-TRANSIENT-MARKER';
  t.style.cssText='position:fixed;top:8px;right:8px;padding:4px;background:yellow;z-index:99999;';
  document.body.appendChild(t);
  await new Promise(r=>setTimeout(r,1500));
  t.remove();
  return 'ok';
})();