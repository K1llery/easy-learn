// Synthetic public fixture: two pages, nested same-page headings, a genuine
// RGB image XObject, and optional document-authored bookmarks. No user paper.
export function paperPdf(bookmarks = true, imageOnly = false): Buffer {
  const first = imageOnly
    ? 'q 160 0 0 80 100 440 cm /Figure Do Q'
    : [
        'BT /F2 22 Tf 50 770 Td (A Public Research Paper) Tj ET',
        'BT /F2 14 Tf 50 730 Td (Abstract) Tj ET',
        'BT /F1 10 Tf 50 708 Td (We examine a public example of document reading.) Tj ET',
        'BT /F2 16 Tf 50 660 Td (1 Introduction) Tj ET',
        'BT /F1 10 Tf 50 638 Td (The system provides addresses and explains the threat.) Tj ET',
        'BT /F1 10 Tf 50 620 Td (Cryptographic attestation ensures provenance.) Tj ET',
        'BT /F1 10 Tf 50 605 Td (A veri-) Tj ET',
        'BT /F1 10 Tf 50 592 Td (fiable design improves the example.) Tj ET',
        'BT /F2 12 Tf 50 580 Td (1.1 Threat Model) Tj ET',
        'BT /F1 10 Tf 50 560 Td (The ephemeral assumption protects the public example.) Tj ET',
        'q 160 0 0 80 100 440 cm /Figure Do Q',
        'BT /F1 10 Tf 50 420 Td (Figure 1: A red test image.) Tj ET',
      ].join('\n');
  const second = [
    'BT /F1 10 Tf 50 750 Td (This paragraph continues the threat model on another page.) Tj ET',
    'BT /F2 16 Tf 50 660 Td (2 Evaluation) Tj ET',
    'BT /F1 10 Tf 50 640 Td (The serendipitous result remains verifiable.) Tj ET',
    'BT /F1 10 Tf 50 620 Td (A Large Language Model (LLM) processes text.) Tj ET',
    'BT /F1 10 Tf 50 604 Td (A Trusted Execution Environment (TEE) protects execution.) Tj ET',
  ].join('\n');
  const resources = '<< /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Figure 9 0 R >> >>';
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${bookmarks && !imageOnly ? '/Outlines 10 0 R' : ''} >>`,
    `<< /Type /Pages /Kids [3 0 R${imageOnly ? '' : ' 4 0 R'}] /Count ${imageOnly ? 1 : 2} >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents 7 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents 8 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream',
    '<< /Type /Outlines /First 11 0 R /Last 13 0 R /Count 3 >>',
    '<< /Title (1 Introduction) /Parent 10 0 R /Dest [3 0 R /XYZ 0 660 null] /First 12 0 R /Last 12 0 R /Count 1 /Next 13 0 R >>',
    '<< /Title (1.1 Threat Model) /Parent 11 0 R /Dest [3 0 R /XYZ 0 580 null] >>',
    '<< /Title (2 Evaluation) /Parent 10 0 R /Prev 11 0 R /Dest [4 0 R /XYZ 0 660 null] >>',
  ];
  return encodePdf(objects);
}
function encodePdf(objects: string[]): Buffer {
  const offsets = [0];
  let raw = '%PDF-1.4\n';
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(raw));
    raw += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(raw);
  raw +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(raw);
}

// More page placeholders than the rendering cache: navigation must stay lazy.
export function pagedPdf(count = 24): Buffer {
  const kids = Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 0; i < count; i++) {
    const text = `BT /F1 18 Tf 50 740 Td (Public page ${i + 1}) Tj ET\nBT /F1 10 Tf 50 710 Td (An ephemeral example of reading.) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  return encodePdf(objects);
}
