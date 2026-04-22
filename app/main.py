import os
import io
import json
import asyncio
from typing import Optional
from pathlib import Path

import anthropic
import fitz  # PyMuPDF
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Literature Review Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


SYSTEM_PROMPT = """You are an expert academic researcher and scholarly writer. Your task is to produce a comprehensive, well-structured literature review from a set of uploaded research papers.

A high-quality literature review must:
- Synthesize findings across papers rather than summarizing each individually
- Identify key themes, debates, methodologies, and theoretical frameworks
- Trace the intellectual development of the field
- Highlight agreements, contradictions, and gaps in the literature
- Use formal academic prose with precise, discipline-appropriate language
- Include in-text citations referencing the provided papers by their titles or author names
- End with a section on identified research gaps and future directions

Structure your review with clear section headings using markdown (##). Write it as a cohesive academic essay, not a list of summaries."""


def extract_text_from_pdf(file_bytes: bytes, filename: str) -> dict:
    """Extract text and metadata from a PDF file."""
    text_pages = []
    metadata = {}

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        metadata = doc.metadata or {}
        for page in doc:
            text = page.get_text()
            if text:
                text_pages.append(text.strip())
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF '{filename}': {str(e)}")

    full_text = "\n\n".join(text_pages)

    # Trim to ~15,000 chars per paper to stay within context limits
    if len(full_text) > 15000:
        full_text = full_text[:15000] + "\n\n[... text truncated for length ...]"

    title = metadata.get("title") or filename.replace(".pdf", "").replace("_", " ").replace("-", " ").title()
    author = metadata.get("author", "Unknown Author")

    return {
        "filename": filename,
        "title": title,
        "author": author,
        "text": full_text,
        "pages": len(text_pages),
    }


def build_review_prompt(papers: list[dict], focus: Optional[str] = None) -> str:
    prompt_parts = []

    focus_text = f"\nFocus area / research question: {focus}\n" if focus else ""
    prompt_parts.append(
        f"Please write a comprehensive literature review based on the following {len(papers)} research paper(s).{focus_text}\n"
        "---\n"
    )

    for i, paper in enumerate(papers, 1):
        prompt_parts.append(
            f"## Paper {i}: {paper['title']}\n"
            f"Author(s): {paper['author']}\n"
            f"File: {paper['filename']}\n\n"
            f"{paper['text']}\n\n"
            f"---\n"
        )

    prompt_parts.append(
        "\nNow write the literature review. Use markdown headings (##) for sections. "
        "Reference the papers by their titles or authors. "
        "Be thorough, critical, and scholarly."
    )

    return "".join(prompt_parts)


@app.get("/")
async def root():
    from fastapi.responses import FileResponse
    return FileResponse(static_dir / "index.html")


@app.post("/api/extract")
async def extract_papers(files: list[UploadFile] = File(...)):
    """Extract text from uploaded PDFs and return metadata."""
    results = []
    for file in files:
        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"'{file.filename}' is not a PDF file.")
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail=f"'{file.filename}' is empty.")
        paper_data = extract_text_from_pdf(content, file.filename)
        results.append({
            "filename": paper_data["filename"],
            "title": paper_data["title"],
            "author": paper_data["author"],
            "pages": paper_data["pages"],
            "char_count": len(paper_data["text"]),
        })
    return JSONResponse({"papers": results})


@app.post("/api/review")
async def generate_review(
    files: list[UploadFile] = File(...),
    focus: Optional[str] = Form(None),
    model: Optional[str] = Form("claude-sonnet-4-6"),
):
    """Generate a literature review from uploaded PDFs. Streams the response."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY environment variable is not set.",
        )

    papers = []
    for file in files:
        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"'{file.filename}' is not a PDF.")
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail=f"'{file.filename}' is empty.")
        paper_data = extract_text_from_pdf(content, file.filename)
        papers.append(paper_data)

    if not papers:
        raise HTTPException(status_code=400, detail="No valid papers provided.")

    user_prompt = build_review_prompt(papers, focus)

    async def stream_review():
        client = anthropic.Anthropic(api_key=api_key)
        try:
            # Send paper titles as initial metadata event
            meta = {
                "event": "meta",
                "papers": [{"title": p["title"], "author": p["author"]} for p in papers],
            }
            yield f"data: {json.dumps(meta)}\n\n"

            with client.messages.stream(
                model=model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            ) as stream:
                for text_chunk in stream.text_stream:
                    payload = {"event": "text", "text": text_chunk}
                    yield f"data: {json.dumps(payload)}\n\n"
                    await asyncio.sleep(0)

            yield f"data: {json.dumps({'event': 'done'})}\n\n"

        except anthropic.APIStatusError as e:
            error_payload = {"event": "error", "message": f"Anthropic API error: {e.message}"}
            yield f"data: {json.dumps(error_payload)}\n\n"
        except Exception as e:
            error_payload = {"event": "error", "message": str(e)}
            yield f"data: {json.dumps(error_payload)}\n\n"

    return StreamingResponse(
        stream_review(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
