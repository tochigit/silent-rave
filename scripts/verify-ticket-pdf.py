"""Fixture PDF inspection: embedded font, text, rendered QR, PNG for visual QA."""
import json, sys
from pathlib import Path
import pymupdf as fitz
import zxingcpp

doc = fitz.open(sys.argv[1])
text = "\n".join(page.get_text() for page in doc)
embedded = all(doc.extract_font(f[0])[3] for page in doc for f in page.get_fonts())
links = [link.get("uri") for page in doc for link in page.get_links() if link.get("uri")]
decoded = []
for page in doc:
    pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
    png = Path(sys.argv[1]).with_suffix(".png")
    pix.save(str(png))
    # ImageView borrows the buffer; retain the Python bytes for the decode.
    samples = pix.samples
    pixels = zxingcpp.ImageView(memoryview(samples), pix.width, pix.height, zxingcpp.ImageFormat.RGB)
    decoded.extend(barcode.text for barcode in zxingcpp.read_barcodes(pixels))
print(json.dumps({"text": text, "embedded": bool(embedded), "decoded": decoded, "links": links, "pages": len(doc)}))
