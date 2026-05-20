# Chat Partner

A pure frontend language-learning chat partner built for GitHub Pages.

[Demo](https://toydogcat.github.io/chat-partner/)

## Features

- Choose a conversation language.
- Switch between casual chat, balanced correction, and coach-like feedback.
- Use browser speech recognition when available.
- Upload a PDF and use its extracted text as conversation context.
- Search Wikipedia from the browser and attach sources to replies.
- Search the bundled topic bank for conversation material.
- Run lightweight browser tools for web lookup, JS math, and topic-bank retrieval.
- Show page/site view counts through Vercount.
- Keep local learning memory, error notes, and shadowing practice in the browser.
- Look up English vocabulary with definitions, examples, synonyms, and estimated CEFR level.

## Topic Bank

Markdown conversation topics live in `public/topic-bank/news`.

The topic bank is generated from local markdown articles and exposed through `public/topic-bank/manifest.json` so the GitHub Pages app can fetch it without a backend.

Each topic includes a lightweight `difficulty` field: `easy`, `medium`, or `hard`.
