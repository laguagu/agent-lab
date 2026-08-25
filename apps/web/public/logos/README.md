# Provider logos

Fetched from [svgl](https://svgl.app), which curates official brand marks.
They are served as separate files rather than inlined JSX on purpose: the Gemini
and Azure marks carry internal `id` attributes (`mask#a`, `linearGradient#a`) that
would collide if two of them were inlined into the same document.

Brand marks are logo-like objects, not UI glyphs, so they keep their own colour and
are never tinted with `currentColor`.
