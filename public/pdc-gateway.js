(function () {
  function buildEmbedUrl(element) {
    var orgSlug = element.getAttribute("org-slug");
    var theme = element.getAttribute("theme");
    var token = element.getAttribute("token");
    var gatewayOrigin = element.getAttribute("gateway-origin");
    var softwareId = element.getAttribute("software-id");
    var softwareUrl = element.getAttribute("software-url");
    var serviceChainId = element.getAttribute("service-chain-id");
    var catalogId = element.getAttribute("catalog-id");
    var skipSelection = element.getAttribute("skip-selection");
    var queryParams = element.getAttribute("query-params");

    var baseOrigin = gatewayOrigin || window.PDC_GATEWAY_ORIGIN || window.location.origin;
    var embedUrl = new URL("/embed", baseOrigin);

    if (orgSlug) embedUrl.searchParams.set("org", orgSlug);
    if (theme) embedUrl.searchParams.set("theme", theme);
    if (token) embedUrl.searchParams.set("token", token);
    if (softwareId) embedUrl.searchParams.set("software_id", softwareId);
    if (softwareUrl) embedUrl.searchParams.set("software_url", softwareUrl);
    if (serviceChainId) embedUrl.searchParams.set("service_chain_id", serviceChainId);
    if (catalogId) embedUrl.searchParams.set("catalog_id", catalogId);
    if (skipSelection) embedUrl.searchParams.set("skip_selection", skipSelection);
    if (queryParams) {
      new URLSearchParams(queryParams).forEach(function (value, key) {
        embedUrl.searchParams.set(key, value);
      });
    }

    return embedUrl.toString();
  }

  function registerPDCGateway() {
    if (window.customElements.get("pdc-gateway")) return;

    class PDCGatewayElement extends HTMLElement {
      static get observedAttributes() {
        return ["org-slug", "theme", "token", "gateway-origin", "height", "software-id", "software-url", "service-chain-id", "catalog-id", "skip-selection", "query-params"];
      }

      connectedCallback() {
        if (this.shadowRoot) return;

        var shadow = this.attachShadow({ mode: "open" });
        var style = document.createElement("style");
        style.textContent = [
          ":host { display:block; width:100%; min-height:600px; }",
          "iframe { width:100%; height:100%; min-height:600px; border:none; background:transparent; }",
        ].join("");
        shadow.appendChild(style);

        var iframe = document.createElement("iframe");
        iframe.setAttribute("loading", "lazy");
        shadow.appendChild(iframe);

        this._iframe = iframe;
        this.render();
      }

      attributeChangedCallback() {
        this.render();
      }

      render() {
        if (!this._iframe) return;

        var height = this.getAttribute("height");
        if (height && /^\d+$/.test(height)) {
          this.style.minHeight = height + "px";
          this._iframe.style.minHeight = height + "px";
        }

        this._iframe.src = buildEmbedUrl(this);
      }
    }

    window.customElements.define("pdc-gateway", PDCGatewayElement);
  }

  window.registerPDCGateway = registerPDCGateway;
  registerPDCGateway();
})();
