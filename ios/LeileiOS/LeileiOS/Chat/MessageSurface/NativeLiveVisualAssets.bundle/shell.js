(() => {
  'use strict';
  let generation = 0, renderedGeneration = 0;
  const target = document.getElementById('visual');
  let mermaidLoad;
  const loadMermaid = () => {
    if (!mermaidLoad) mermaidLoad = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'leilei-visual://bundle/mermaid.js';
      script.onload = resolve; script.onerror = () => { mermaidLoad = null; reject(Error('Local diagram engine unavailable')); };
      document.head.append(script);
    });
    return mermaidLoad;
  };
  let lastHeight = 0, frame = 0;
  const reportHeight = token => {
    const height = Math.min(480,Math.max(44,target.scrollHeight+16));
    if (generation === token && renderedGeneration === token && Math.abs(height-lastHeight) > 0.5) { lastHeight = height; emit('contentHeight',token,{height}); }
  };
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    const token = generation;
    frame = requestAnimationFrame(() => reportHeight(token));
  }).observe(target);
  const emit = (event, token, extra = {}) => {
    window.webkit.messageHandlers.visual.postMessage({event, generation:token, ...extra});
  };
  function safeDiagram(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror,script,foreignObject,image,iframe,animate,animateMotion,animateTransform,set')) throw Error('Unsafe or invalid diagram output');
    const root = doc.documentElement;
    if (root.localName !== 'svg') throw Error('Missing diagram SVG');
    for (const element of [root,...root.querySelectorAll('*')]) {
      for (const attr of [...element.attributes]) {
        if (/^on/i.test(attr.name)) throw Error('Active diagram attribute');
        if (/^(href|xlink:href|src)$/i.test(attr.name) && !/^#[A-Za-z0-9_-]+$/.test(attr.value)) throw Error('External diagram reference');
        if (/url\(/i.test(attr.value) && !/^url\(#[A-Za-z0-9_-]+\)$/.test(attr.value)) throw Error('External diagram style');
      }
      if (element.localName === 'style' && /@import|url\(\s*[^#]/i.test(element.textContent)) throw Error('External diagram CSS');
    }
    return document.importNode(root,true);
  }
  window.leileiVisualCancel = token => { generation = token; renderedGeneration = 0; };
  window.leileiVisualRender = async input => {
    generation = input.generation;
    const token = generation;
    try {
      document.body.style.setProperty('--ink',input.dark ? '#eeeeee' : '#171717');
      document.body.style.fontSize = `${Math.min(2,Math.max(1,input.scale || 1))*17}px`;
      let content;
      if (input.kind === 'math') {
        content = document.createElement('div');
        katex.render(input.source,content,{displayMode:true,throwOnError:true,trust:false,maxSize:20,maxExpand:1000,strict:'error',output:'htmlAndMathml',macros:{}});
      } else if (input.kind === 'mermaid') {
        await loadMermaid();
        if (generation !== token) return;
        LeileiMermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:input.dark?'dark':'default',htmlLabels:false,fontFamily:'system-ui',maxTextSize:20000,maxEdges:500,
          flowchart:{htmlLabels:false,useMaxWidth:true},sequence:{useMaxWidth:true},
          secure:['securityLevel','startOnLoad','maxTextSize','maxEdges','htmlLabels','flowchart','sequence','theme','fontFamily']});
        const result = await LeileiMermaid.render(`visual-${token}`,input.source);
        content = safeDiagram(result.svg); // Never call bindFunctions/click handlers.
      } else if (input.kind === 'svg') {
        content = safeDiagram(input.source); // Native strict XML subset already validated verified bytes.
      } else { throw Error('Unsupported visual input'); }
      if (generation !== token) return;
      target.replaceChildren(content); renderedGeneration = token;
      emit('ready',token);
      lastHeight = 0; reportHeight(token);
      document.fonts.ready.then(() => reportHeight(token));
    } catch (error) {
      if (generation !== token) return;
      target.replaceChildren(); renderedGeneration = 0;
      emit('renderError',token,{message:String(error.message || error).slice(0,180)});
    }
  };
  window.open = () => null;
  document.addEventListener('click',event => { event.preventDefault(); event.stopPropagation(); },true);
})();
