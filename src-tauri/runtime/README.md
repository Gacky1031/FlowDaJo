# WebView2 loader

`WebView2Loader.dll` is the x64 Microsoft WebView2 loader supplied by the `webview2-com-sys` dependency during the verified Windows GNU build. It is included explicitly as a Tauri bundle resource because the GNU executable dynamically imports it.

This DLL is not the WebView2 browser runtime. Version 0.2.0 also bundles the full fixed browser runtime in `WebView2/`, R in `R/`, and corresponding R/package sources in `sources/`. No system R or Evergreen WebView2 installation is required. See THIRD-PARTY-NOTICES.md and r-manifest.json for versions, licenses and source provenance.

Dependency source: https://github.com/wravery/webview2-rs
Microsoft WebView2 documentation: https://learn.microsoft.com/microsoft-edge/webview2/
