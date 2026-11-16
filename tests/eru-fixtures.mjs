// Small PDF and PowerPoint files for the ERU import tests (unit and browser). Built here, byte by byte, so the tests need no binary files.
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);

/** A PDF string: \, ( and ) escaped; a bullet (•) as its WinAnsi code. */
const pdfString = (s) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/•/g, "\\225")})`;

/**
 * A PDF of US-letter pages in Helvetica. Each page is a list of lines: { text, size, x, y } (y from the bottom, in points).
 * @param {{ text: string; size: number; x?: number; y: number }[][]} pages
 */
export function makePdf(pages) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const lines of pages) {
    const stream = lines.map((l) => `BT /F1 ${l.size} Tf ${l.x ?? 72} ${l.y} Td ${pdfString(l.text)} Tj ET`).join("\n");
    const contents = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** The sample PDF: a title, a heading, a paragraph over three lines (one word hyphenated), bullets, a page number, and a second page. */
export function samplePdf() {
  return makePdf([
    [
      { text: "Pune Manufacturing Survey", size: 24, y: 720 },
      { text: "Key findings", size: 16, y: 680 },
      { text: "Output across the Pune region rose in the second quarter, led by auto-", size: 11, y: 650 },
      { text: "motive components and engineering goods, while textiles held steady", size: 11, y: 636 },
      { text: "through the period.", size: 11, y: 622 },
      { text: "• Exports up 12 percent", size: 11, y: 596 },
      { text: "• Hiring plans remain firm", size: 11, y: 582 },
      { text: "1", size: 9, x: 300, y: 40 },
    ],
    [
      { text: "Outlook", size: 16, y: 720 },
      { text: "Members expect demand to stay strong into the festive season.", size: 11, y: 690 },
      { text: "2", size: 9, x: 300, y: 40 },
    ],
  ]);
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const shape = (ph, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const para = (runs, pPr = "") => `<a:p>${pPr}${runs}<a:endParaRPr lang="en-IN"/></a:p>`;
const run = (t, rPr = '<a:rPr lang="en-IN"/>') => `<a:r>${rPr}<a:t>${t}</a:t></a:r>`;
const cell = (t, attrs = "") => `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${para(run(t))}</a:txBody><a:tcPr/></a:tc>`;
const slide = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`;

/**
 * The sample .pptx (the parts the import reads): two slides, listed in the deck in the opposite order to their file numbers. The first: a
 * title, bullets on two levels (one run bold, one with an escaped "&"), a plain text box and a slide-number footer (left out). The second:
 * a title, a subtitle and a table with a header row and a cell spanning two columns.
 */
export async function samplePptx() {
  const JSZip = req("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`);
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>',
  );
  // Shown first (r:id rId3 → slide2.xml).
  zip.file(
    "ppt/slides/slide2.xml",
    slide(
      shape('<p:ph type="title"/>', para(run("Quarterly Highlights"))) +
        shape(
          '<p:ph idx="1"/>',
          para(run("Revenue grew ") + run("18 percent", '<a:rPr lang="en-IN" b="1"/>')) + para(run("Driven by exports"), '<a:pPr lvl="1"/>') + para(run("R&amp;D spend doubled")),
        ) +
        shape("", para(run("Source: MCCIA member survey"))) +
        shape('<p:ph type="sldNum" idx="12"/>', para(run("1"))),
    ),
  );
  zip.file(
    "ppt/slides/slide1.xml",
    slide(
      shape('<p:ph type="title"/>', para(run("Sector Table"))) +
        shape('<p:ph type="subTitle" idx="1"/>', para(run("By industry"))) +
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="1"/><a:gridCol w="1"/></a:tblGrid><a:tr h="1">${cell("Sector")}${cell("Growth")}</a:tr><a:tr h="1">${cell("Auto")}${cell("14%")}</a:tr><a:tr h="1">${cell("All sectors steady", ' gridSpan="2"')}${cell("", ' hMerge="1"')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    ),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A Word file with a heading and a 2×3 table (header row), made with the docx package. */
export async function tableDocx() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = req("docx");
  const row = (cells, bold = false) => new TableRow({ tableHeader: bold || undefined, children: cells.map((t) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] })) });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Cluster Comparison")] }),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(["Cluster", "Units", "Jobs"], true), row(["Chakan", "420", "61000"]), row(["Hinjewadi", "310", "88000"])] }),
          new Paragraph({ children: [new TextRun("Figures from the 2026 survey.")] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
