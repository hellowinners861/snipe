# Assets and licenses

All models and audio under `public/assets/models/` and `public/assets/audio/`
were created specifically for SNIPE by the reproducible original generator
[`scripts/generate-assets.py`](scripts/generate-assets.py). They contain no
downloaded photographs, real product logos, samples, recordings or melodies.

These original visual and audio assets are dedicated to the public domain
under **CC0 1.0 Universal**: <https://creativecommons.org/publicdomain/zero/1.0/>.
The GLB models are fictional game props and are not fabrication geometry.

`public/assets/manifest.json` records each asset's path, size, SHA-256,
origin and license. Rerun `python3 scripts/generate-assets.py` to rebuild them
using the Python 3 standard library.

Application dependencies retain their own package licenses. Babylon.js uses
Apache-2.0; Vite, TypeScript and testing packages retain the licenses included
in their published packages. No external runtime asset URLs are required.
