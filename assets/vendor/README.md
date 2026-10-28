# Bundled dependencies

- `mux-mp4.min.js`: mux.js **6.3.0**, the MP4 browser distribution from https://unpkg.com/mux.js@6.3.0/dist/mux-mp4.min.js. Apache-2.0; see `mux-LICENSE`. This distribution exports `muxjs.Transmuxer` directly. Loaded locally in a dedicated worker; no remote runtime code or native FFmpeg is required.
- `../icons/*.svg`: Lucide Static **1.62.0**, ISC and retained Feather attribution in `../icons/LICENSE`. `../js/icons.js` is generated from these files with `node scripts/build-icons.mjs`.
- `../fonts/poppins-*.ttf` and `../fonts/montserrat-variable.ttf`: Google Fonts Poppins (400/500/600) and Montserrat variable. SIL Open Font License; see the corresponding `*-OFL.txt` files. Fonts are loaded from the extension package.

FFmpeg and ffprobe are used only to generate and inspect neutral test fixtures. The shipped extension does not depend on an installed native media tool.
