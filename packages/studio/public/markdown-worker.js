function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeLink(href) {
  const url = String(href ?? "").trim();
  if (/^(https?:|mailto:)/i.test(url) || url.startsWith("/") || url.startsWith("#")) return url;
  return "";
}

function renderInline(escaped) {
  const codes = [];
  const saved = escaped.replaceAll(/`([^`]+)`/g, (_, code) => {
    const token = `\uE000${codes.length}\uE001`;
    codes.push(code);
    return token;
  });
  const formatted = saved
    .replaceAll(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replaceAll(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replaceAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (all, label, href) => {
      const url = safeLink(href);
      if (!url) return all;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
  return formatted.replaceAll(/\uE000(\d+)\uE001/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(header, rows) {
  const head = splitTableRow(header).map((cell) => `<th>${renderInline(escapeHtml(cell))}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${splitTableRow(row).map((cell) => `<td>${renderInline(escapeHtml(cell))}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function isMarkdownBoundary(line, next) {
  if (/^(#{1,6} |> |[-*+] |\d+\. )/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) return true;
  return Boolean(next && line.trim().startsWith("|") && isTableSeparator(next));
}

function renderBlocks(text) {
  const lines = String(text ?? "").split("\n");
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      html.push("<hr>");
      index += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      const quote = [];
      while (index < lines.length && (lines[index].startsWith("> ") || lines[index].trim() === ">")) {
        quote.push(lines[index].replace(/^> ?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderBlocks(quote.join("\n"))}</blockquote>`);
      continue;
    }
    if (/^[-*+] /.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*+] /.test(lines[index])) {
        items.push(`<li>${renderInline(escapeHtml(lines[index].slice(2)))}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\. /.test(lines[index])) {
        items.push(`<li>${renderInline(escapeHtml(lines[index].replace(/^\d+\. /, "")))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.trim().startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = lines[index];
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(lines[index]);
        index += 1;
      }
      html.push(renderTable(header, rows));
      continue;
    }
    const heading = /^(#{1,6}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      index += 1;
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBoundary(lines[index], lines[index + 1])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    html.push(`<p>${renderInline(escapeHtml(paragraph.join("\n"))).replaceAll("\n", "<br>")}</p>`);
  }
  return html.join("");
}

function renderMarkdown(source) {
  const text = String(source ?? "").replaceAll("\r\n", "\n");
  const parts = [];
  const pattern = /```([\w-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    parts.push(renderBlocks(text.slice(last, index)));
    parts.push(`<pre class="md-code"><code>${escapeHtml(match[2].replace(/\n$/, ""))}</code></pre>`);
    last = index + match[0].length;
  }
  parts.push(renderBlocks(text.slice(last)));
  return parts.join("");
}


self.onmessage = (event) => {
  const texts = Array.isArray(event.data?.texts) ? event.data.texts : [];
  const html = texts.map((text) => {
    try {
      return renderMarkdown(text);
    } catch {
      return "";
    }
  });
  self.postMessage({ id: event.data?.id, html });
};
