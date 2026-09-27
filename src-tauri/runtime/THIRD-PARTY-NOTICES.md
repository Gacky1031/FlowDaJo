# Bundled runtime components

This distribution includes unmodified R 4.5.1 and the 30 packages listed in `r-manifest.json`. Each R package retains its DESCRIPTION, LICENSE/LICENCE and other supplied notices. R's own license text is in `R/COPYING` and `R/doc/COPYING`; additional component notices are in `R/doc/COPYRIGHTS` and `R/share/licenses`.

Exact upstream source archives for R and the non-base packages are included in `sources/`. `sources/manifest.json` records the download URLs, versions and SHA-256 hashes. R base-package sources are part of the R source archive. Packages include code under GPL, AGPL, Artistic, MIT, BSD and Boost licenses; see each component's own terms. The build preserves the upstream binaries rather than compiling modified versions.

Microsoft WebView2 Fixed Version Runtime 153.0.4234.32 x64 is distributed as a separate proprietary runtime component, under Microsoft's WebView2 terms, not under the R package licenses. WebView2Loader.dll is supplied by the Microsoft WebView2 SDK (1.0.3650.58). The original executable signature was checked before packaging.

Official download page: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
Fixed runtime archive: https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/c3d95bc1-a0a7-4ca6-aaa1-fa0ac3dd1a37/Microsoft.WebView2.FixedVersionRuntime.153.0.4234.32.x64.cab
Microsoft distribution instructions: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
R license information: https://www.r-project.org/Licenses/

Fixed WebView2 is updated by shipping a new FlowDaJo package. It does not use the computer's Evergreen installation or its automatic updates.
