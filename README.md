# LitReview AI — Literature Review Tool

Upload research PDFs and get a synthesized, academic-quality literature review powered by Claude.

## Features

- Drag-and-drop upload for multiple PDF papers
- Automatic text extraction from PDFs
- Optional research focus / guiding question
- Streams the review in real-time as Claude generates it
- Clean academic prose with markdown headings
- Copy to clipboard or download as text

## Setup

### 1. Install dependencies

```bash
cd app
pip install -r requirements.txt
```

### 2. Set your Anthropic API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run the server

```bash
cd app
uvicorn main:app --reload --port 8000
```

### 4. Open the app

Navigate to [http://localhost:8000](http://localhost:8000) in your browser.

## Usage

1. Drop one or more PDF research papers onto the upload zone (or click "Choose Files")
2. Optionally type a research focus or guiding question
3. Select the Claude model (Sonnet is the default — good balance of quality and speed)
4. Click **Generate Literature Review**
5. The review streams in live; copy or download when done

## Project structure

```
app/
├── main.py           # FastAPI backend — PDF parsing, Claude API, SSE streaming
├── requirements.txt
└── static/
    ├── index.html    # Single-page app shell
    ├── style.css     # Styling
    └── app.js        # Frontend logic (upload, SSE, markdown render)
```

## Notes

- Each PDF is trimmed to ~15 000 characters of extracted text to stay within context limits.  For very long papers the body text is truncated; abstracts and introductions are usually captured in full.
- The `ANTHROPIC_API_KEY` environment variable must be set before starting the server.
