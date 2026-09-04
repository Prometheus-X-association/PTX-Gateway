export function buildCredentialSrcdoc(
  htmlContent: string,
  jsonContent: string,
  pngBlobUrl: string,
): string {
  let jsonBase64 = "";
  try {
    jsonBase64 = btoa(unescape(encodeURIComponent(jsonContent)));
  } catch {
    jsonBase64 = btoa(jsonContent);
  }

  const injectedScript = `<script>
(function(){
  var _j=decodeURIComponent(escape(atob(${JSON.stringify(jsonBase64)})));
  window.__ptxCredPng=${JSON.stringify(pngBlobUrl)};
  var _f=window.fetch.bind(window);
  window.fetch=function(u,o){
    var us=String(u),isH=o&&String(o.method||"").toUpperCase()==="HEAD";
    if(/\\.json/i.test(us)||us==="carisma-raw-data.json"){
      if(isH)return Promise.resolve(new Response("",{status:200}));
      return Promise.resolve(new Response(_j,{status:200,headers:{"Content-Type":"application/json"}}));
    }
    if(/\\.png/i.test(us)||us==="system-process-diagram.png"){
      if(isH)return Promise.resolve(new Response("",{status:200}));
    }
    return _f(u,o);
  };
})();
</script>`;

  let html = htmlContent;
  html = html.replace("<head>", `<head>\n${injectedScript}`);
  html = html.replace(
    "state.defaultDiagramPath = paths.diagramPath;",
    "state.defaultDiagramPath = window.__ptxCredPng || paths.diagramPath;",
  );
  return html;
}

export function createCredentialPngObjectUrl(pngBase64: string): string {
  const pngBytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([pngBytes], { type: "image/png" }));
}
