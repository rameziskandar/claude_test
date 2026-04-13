/* ── State ─────────────────────────────────────────────────── */
const files = new Map(); // filename → File object

/* ── DOM refs ──────────────────────────────────────────────── */
const dropzone    = document.getElementById('dropzone');
const fileInput   = document.getElementById('fileInput');
const fileList    = document.getElementById('fileList');
const generateBtn = document.getElementById('generateBtn');
const focusInput  = document.getElementById('focusInput');
const modelSelect = document.getElementById('modelSelect');
const uploadPanel = document.getElementById('uploadPanel');

const reviewPanel = document.getElementById('reviewPanel');
const reviewBody  = document.getElementById('reviewBody');
const paperChips  = document.getElementById('paperChips');
const statusBadge = document.getElementById('statusBadge');
const copyBtn     = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn    = document.getElementById('resetBtn');

/* ── File handling ─────────────────────────────────────────── */
function addFiles(newFiles) {
  for (const f of newFiles) {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      showUploadError(`"${f.name}" is not a PDF — only PDF files are supported.`);
      continue;
    }
    files.set(f.name, f);
  }
  renderFileList();
}

function removeFile(name) {
  files.delete(name);
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = '';
  if (files.size === 0) {
    fileList.hidden = true;
    generateBtn.disabled = true;
    return;
  }

  fileList.hidden = false;
  generateBtn.disabled = false;

  for (const [name, file] of files) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <div class="file-icon">PDF</div>
      <span class="file-name" title="${esc(name)}">${esc(name)}</span>
      <span class="file-size">${formatBytes(file.size)}</span>
      <button class="file-remove" data-name="${esc(name)}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>`;
    fileList.appendChild(li);
  }

  fileList.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFile(btn.dataset.name));
  });
}

function showUploadError(msg) {
  const existing = uploadPanel.querySelector('.error-box');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'error-box';
  el.style.marginTop = '12px';
  el.textContent = msg;
  uploadPanel.insertBefore(el, uploadPanel.querySelector('.focus-field'));
  setTimeout(() => el.remove(), 5000);
}

/* ── Drag and drop ─────────────────────────────────────────── */
dropzone.addEventListener('click', (e) => {
  if (!e.target.closest('.btn')) fileInput.click();
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('over');
});

['dragleave', 'dragend'].forEach(ev =>
  dropzone.addEventListener(ev, () => dropzone.classList.remove('over'))
);

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  addFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

/* ── Markdown renderer (lightweight) ──────────────────────── */
function renderMarkdown(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // H1
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // H2
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  // H3
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, (m) => `<ul>${m}</ul>`);
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Paragraphs (blank line separated blocks not already in tags)
  html = html
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(h[1-3]|ul|ol|li|pre|blockquote)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, ' ')}</p>`;
    })
    .join('\n');

  return html;
}

/* ── Generate review ───────────────────────────────────────── */
generateBtn.addEventListener('click', startReview);

async function startReview() {
  if (files.size === 0) return;

  generateBtn.disabled = true;

  // Show review panel
  uploadPanel.hidden  = true;
  reviewPanel.hidden  = false;
  reviewBody.innerHTML = '';
  paperChips.innerHTML = '';
  copyBtn.hidden    = true;
  downloadBtn.hidden = true;

  setStatus('generating', 'Generating...');

  // Build form data
  const formData = new FormData();
  for (const f of files.values()) formData.append('files', f);
  const focus = focusInput.value.trim();
  if (focus) formData.append('focus', focus);
  formData.append('model', modelSelect.value);

  let rawText = '';
  let lastWasSection = false;

  // Add streaming cursor placeholder
  reviewBody.innerHTML = '<span class="cursor"></span>';
  const cursor = reviewBody.querySelector('.cursor');

  try {
    const response = await fetch('/api/review', { method: 'POST', body: formData });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || 'Server error');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));

        if (data.event === 'meta') {
          renderPaperChips(data.papers);
        } else if (data.event === 'text') {
          rawText += data.text;
          cursor.remove();
          reviewBody.innerHTML = renderMarkdown(rawText);
          reviewBody.appendChild(document.createElement('span')).className = 'cursor';
        } else if (data.event === 'done') {
          // Remove cursor, final render
          reviewBody.innerHTML = renderMarkdown(rawText);
          setStatus('done', 'Complete');
          copyBtn.hidden    = false;
          downloadBtn.hidden = false;
        } else if (data.event === 'error') {
          throw new Error(data.message);
        }
      }
    }

  } catch (err) {
    reviewBody.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    setStatus('error', 'Error');
  }
}

function renderPaperChips(papers) {
  paperChips.innerHTML = '';
  for (const p of papers) {
    const chip = document.createElement('div');
    chip.className = 'paper-chip';
    chip.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/>
        <path d="M3 4h6M3 6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      <span>${esc(p.title)}</span>`;
    paperChips.appendChild(chip);
  }
}

function setStatus(state, label) {
  const dot = statusBadge.querySelector('.status-dot');
  dot.className = `status-dot ${state}`;
  statusBadge.childNodes[statusBadge.childNodes.length - 1].textContent = label;
}

/* ── Copy ──────────────────────────────────────────────────── */
copyBtn.addEventListener('click', async () => {
  const text = reviewBody.innerText;
  await navigator.clipboard.writeText(text);
  copyBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M2 10V2h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg> Copy`;
  }, 1800);
});

/* ── Download ──────────────────────────────────────────────── */
downloadBtn.addEventListener('click', () => {
  const text = reviewBody.innerText;
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'literature_review.txt';
  a.click();
  URL.revokeObjectURL(url);
});

/* ── Reset ─────────────────────────────────────────────────── */
resetBtn.addEventListener('click', () => {
  files.clear();
  renderFileList();
  focusInput.value = '';
  uploadPanel.hidden  = false;
  reviewPanel.hidden  = true;
  generateBtn.disabled = true;
});

/* ── Utilities ─────────────────────────────────────────────── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
