"""Markdown parts -> one PDF (ReportLab). Supports #/##/###, bullets, numbered, tables, code, > tips, inline **b** *i* `c`."""

import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph,
                                Preformatted, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

SRC = Path(sys.argv[1])
OUT = sys.argv[2]
ss = getSampleStyleSheet()
ACCENT = colors.HexColor("#1f4e79")
SOFT = colors.HexColor("#eef4fa")
LINE = colors.HexColor("#c8d6e5")

H1 = ParagraphStyle("H1", parent=ss["Heading1"], textColor=ACCENT, fontSize=20, leading=25, spaceAfter=10,
                    keepWithNext=1)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], textColor=ACCENT, fontSize=14.5, leading=19, spaceBefore=12,
                    spaceAfter=5, keepWithNext=1)
H3 = ParagraphStyle("H3", parent=ss["Heading3"], textColor=colors.HexColor("#2d6a9f"), fontSize=12, leading=16,
                    spaceBefore=8, spaceAfter=3, keepWithNext=1)
B = ParagraphStyle("B", parent=ss["BodyText"], fontSize=10.3, leading=15, spaceAfter=5)
BL = ParagraphStyle("BL", parent=B, leftIndent=14, bulletIndent=3, spaceAfter=2.5)
BL2 = ParagraphStyle("BL2", parent=BL, leftIndent=28, bulletIndent=17)
CODE = ParagraphStyle("CODE", parent=ss["Code"], fontSize=7.6, leading=9.8, backColor=colors.HexColor("#f4f6f8"),
                      borderPadding=6, spaceBefore=4, spaceAfter=9)
CELL = ParagraphStyle("CELL", parent=B, fontSize=9.2, leading=12.6, spaceAfter=0)
HEAD = ParagraphStyle("HEAD", parent=CELL, textColor=colors.white, fontName="Helvetica-Bold")
TIP = ParagraphStyle("TIP", parent=B, backColor=colors.HexColor("#fff8e6"), borderColor=colors.HexColor("#f0c36d"),
                     borderWidth=0.6, borderPadding=7, spaceBefore=5, spaceAfter=10)
WIDTH = A4[0] - 40 * mm

REPL = {"→": "->", "₹": "Rs ", "≤": "<=", "≥": ">=", "←": "<-", "↔": "<->",
        "✓": "[ok]", "✗": "[x]", "≈": "~", "×": "x", "…": "..."}


def clean(s: str) -> str:
    for k, v in REPL.items():
        s = s.replace(k, v)
    return s


def inline(s: str) -> str:
    s = clean(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    parts = re.split(r"(`[^`]+`)", s)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(f"<font face='Courier' color='#9c2a00'>{p[1:-1]}</font>")
        else:
            p = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", p)
            p = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", p)
            out.append(p)
    return "".join(out)


def make_table(rows: list[list[str]]):
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    lens = [max(len(r[c]) for r in rows) for c in range(ncol)]
    weights = [min(max(n, 8), 70) for n in lens]
    widths = [WIDTH * w / sum(weights) for w in weights]
    data = [[Paragraph(inline(c), HEAD if i == 0 else CELL) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT), ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
    ]))
    return t


def parse(text: str, story: list):
    lines = text.splitlines()
    i = 0
    first_h1 = True
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if s.startswith("```"):
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(clean(lines[i]))
                i += 1
            story.append(Preformatted("\n".join(buf), CODE))
        elif s.startswith("# "):
            if not first_h1 or story:
                story.append(PageBreak())
            first_h1 = False
            story.append(Paragraph(inline(s[2:]), H1))
        elif s.startswith("## "):
            story.append(Paragraph(inline(s[3:]), H2))
        elif s.startswith("### "):
            story.append(Paragraph(inline(s[4:]), H3))
        elif s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            story.append(make_table(rows))
            story.append(Spacer(1, 7))
            continue
        elif s.startswith("> "):
            buf = [s[2:]]
            while i + 1 < len(lines) and lines[i + 1].strip().startswith("> "):
                i += 1
                buf.append(lines[i].strip()[2:])
            story.append(Paragraph(inline(" ".join(buf)), TIP))
        elif re.match(r"^\s*[-*] ", line):
            indent = len(line) - len(line.lstrip())
            story.append(Paragraph(inline(re.sub(r"^\s*[-*] ", "", line)), BL2 if indent >= 2 else BL,
                                   bulletText="•" if indent < 2 else "-"))
        elif re.match(r"^\d+\. ", s):
            n, rest = s.split(". ", 1)
            story.append(Paragraph(inline(rest), BL, bulletText=f"{n}."))
        elif s == "---":
            story.append(Spacer(1, 6))
        elif s:
            buf = [s]
            while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(
                    r"^(#|\||```|> |\s*[-*] |\d+\. |---)", lines[i + 1].strip()):
                i += 1
                buf.append(lines[i].strip())
            story.append(Paragraph(inline(" ".join(buf)), B))
        i += 1


class Doc(BaseDocTemplate):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        frame = Frame(20 * mm, 18 * mm, A4[0] - 40 * mm, A4[1] - 36 * mm, id="f")
        self.addPageTemplates([PageTemplate("p", [frame], onPage=self.footer)])

    @staticmethod
    def footer(c, d):
        if d.page == 1:
            return
        c.saveState()
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.grey)
        c.drawString(20 * mm, 10 * mm, "Splity - Project Mastery Report")
        c.drawRightString(A4[0] - 20 * mm, 10 * mm, f"Page {d.page}")
        c.restoreState()

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name in ("H1", "H2"):
            level = 0 if f.style.name == "H1" else 1
            text = re.sub("<[^>]+>", "", f.getPlainText())
            key = f"h{id(f)}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=level, closed=level > 0)
            self.notify("TOCEntry", (level, text, self.page, key))


story = [Spacer(1, 50 * mm),
         Paragraph("Splity", ParagraphStyle("t", parent=H1, fontSize=38, leading=44, alignment=TA_CENTER)),
         Paragraph("Project Mastery Report", ParagraphStyle("st", parent=B, fontSize=17, leading=22,
                                                              alignment=TA_CENTER)),
         Spacer(1, 8),
         Paragraph("Complete technical study guide for interviews - simple Hinglish mein",
                   ParagraphStyle("st2", parent=B, fontSize=11, alignment=TA_CENTER, textColor=colors.grey)),
         Spacer(1, 30 * mm),
         Paragraph("Based only on the actual repository: api/ (FastAPI, Python) and frontend/ (React). "
                   "Jo cheez code se verify nahi hui, woh clearly 'not verified' ya 'not implemented' likhi hai.",
                   ParagraphStyle("st3", parent=B, alignment=TA_CENTER)),
         PageBreak(),
         Paragraph("Table of Contents", H1.clone("toc", keepWithNext=0))]
toc = TableOfContents()
toc.levelStyles = [ParagraphStyle("t0", fontName="Helvetica-Bold", fontSize=10.5, leading=15, leftIndent=0),
                   ParagraphStyle("t1", fontName="Helvetica", fontSize=9, leading=12, leftIndent=14,
                                  textColor=colors.HexColor("#333333"))]
story.append(toc)
for part in sorted(SRC.glob("part*.md")):
    parse(part.read_text(encoding="utf-8"), story)

Doc(OUT, pagesize=A4, title="Splity Project Mastery Report").multiBuild(story)
print("ok", OUT)
