/**
 * pdfExtractor.ts — Pure-JS PDF text extraction for React Native
 *
 * Extracts text directly from PDF binary without pdfjs-dist
 * (which requires Web Workers / DOM APIs unavailable in RN).
 *
 * Handles:
 *   - Uncompressed text streams (BT/ET blocks with Tj/TJ operators)
 *   - FlateDecode compressed streams (via manual inflate)
 *   - Hex-encoded strings <4865...>
 *   - Parenthesized strings (Hello World)
 *   - Page count from PDF trailer
 */

export interface PDFResult {
  text: string;
  numPages: number;
}

/**
 * Extract all text from a PDF given its raw bytes.
 */
export async function extractPdfText(data: Uint8Array): Promise<PDFResult> {
  console.log('[PDF] extractPdfText: ', data.length, 'bytes');

  // Verify PDF magic
  if (data[0] !== 0x25 || data[1] !== 0x50 || data[2] !== 0x44 || data[3] !== 0x46) {
    throw new Error('Not a valid PDF file');
  }

  const raw = uint8ToString(data);

  // Count pages
  const numPages = countPages(raw);
  console.log('[PDF] Detected pages:', numPages);

  // Find and extract all streams
  const texts: string[] = [];
  let offset = 0;

  while (offset < raw.length) {
    const streamStart = raw.indexOf('stream\r\n', offset);
    const streamStartAlt = raw.indexOf('stream\n', offset);
    let sPos = -1;
    let headerLen = 0;

    if (streamStart >= 0 && (streamStartAlt < 0 || streamStart <= streamStartAlt)) {
      sPos = streamStart;
      headerLen = 8; // "stream\r\n"
    } else if (streamStartAlt >= 0) {
      sPos = streamStartAlt;
      headerLen = 7; // "stream\n"
    }

    if (sPos < 0) break;

    const endStream = raw.indexOf('endstream', sPos + headerLen);
    if (endStream < 0) break;

    // Get the object header (look back for /Length, /Filter, etc.)
    const objHeader = raw.substring(Math.max(0, sPos - 500), sPos);

    // Extract stream bytes
    const streamBytes = data.slice(sPos + headerLen, endStream);

    // Determine if compressed
    const isFlate = objHeader.includes('/FlateDecode');

    let decoded = '';
    if (isFlate) {
      try {
        const inflated = inflate(streamBytes);
        decoded = uint8ToString(inflated);
      } catch (e) {
        // Can't decompress this stream — skip (expected for non-text streams)
        console.warn('[PDF] FlateDecode inflate skipped:', e);
      }
    } else {
      decoded = uint8ToString(streamBytes);
    }

    // Extract text from the decoded stream
    if (decoded.length > 0) {
      const extracted = extractTextFromStream(decoded);
      if (extracted.trim().length > 0) {
        texts.push(extracted);
      }
    }

    offset = endStream + 9;
  }

  const fullText = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  console.log('[PDF] Extracted:', fullText.length, 'chars from', texts.length, 'streams');

  if (fullText.length === 0) {
    throw new Error('Could not extract text — PDF may be image-based or encrypted');
  }

  return { text: fullText, numPages };
}

// ── Text extraction from decoded stream ──────────────────────

function extractTextFromStream(stream: string): string {
  const lines: string[] = [];
  let i = 0;

  while (i < stream.length) {
    // Find BT (begin text) blocks
    const bt = stream.indexOf('BT', i);
    if (bt < 0) break;

    const et = stream.indexOf('ET', bt + 2);
    if (et < 0) break;

    const block = stream.substring(bt + 2, et);
    const blockText = extractTextFromBlock(block);
    if (blockText.trim()) {
      lines.push(blockText);
    }

    i = et + 2;
  }

  return lines.join('\n');
}

function extractTextFromBlock(block: string): string {
  const parts: string[] = [];

  // Match Tj operator: (text) Tj
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRegex.exec(block)) !== null) {
    parts.push(unescapePdfString(m[1]));
  }

  // Match TJ operator: [(text) -kern (text)] TJ
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((m = tjArrayRegex.exec(block)) !== null) {
    const inner = m[1];
    const strRegex = /\(([^)]*)\)/g;
    let s: RegExpExecArray | null;
    while ((s = strRegex.exec(inner)) !== null) {
      parts.push(unescapePdfString(s[1]));
    }
    // Also match hex strings
    const hexRegex = /<([0-9a-fA-F]+)>/g;
    while ((s = hexRegex.exec(inner)) !== null) {
      parts.push(hexToString(s[1]));
    }
  }

  // Match hex string Tj: <hex> Tj
  const hexTjRegex = /<([0-9a-fA-F]+)>\s*Tj/g;
  while ((m = hexTjRegex.exec(block)) !== null) {
    parts.push(hexToString(m[1]));
  }

  // Check for Td/TD (move to next line) and add spacing
  if (parts.length === 0) return '';

  return parts.join('');
}

function unescapePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function hexToString(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length - 1; i += 2) {
    const code = parseInt(hex.substring(i, i + 2), 16);
    if (code > 0) str += String.fromCharCode(code);
  }
  return str;
}

// ── Page count ───────────────────────────────────────────────

function countPages(raw: string): number {
  // Look for /Type /Pages ... /Count N
  const pagesMatch = raw.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
  if (pagesMatch) return parseInt(pagesMatch[1], 10);

  // Fallback: count /Type /Page occurrences (not /Pages)
  const pageMatches = raw.match(/\/Type\s*\/Page(?!\s*s)/g);
  return pageMatches?.length ?? 1;
}

// ── Helpers ──────────────────────────────────────────────────

function uint8ToString(arr: Uint8Array): string {
  // Process in chunks to avoid stack overflow on large PDFs
  const CHUNK = 8192;
  let result = '';
  for (let i = 0; i < arr.length; i += CHUNK) {
    const slice = arr.subarray(i, Math.min(i + CHUNK, arr.length));
    result += String.fromCharCode.apply(null, slice as any);
  }
  return result;
}

// ── Minimal inflate (FlateDecode / zlib) ─────────────────────
// Handles the zlib wrapper (2-byte header) + raw DEFLATE stream.
// Supports fixed and dynamic Huffman codes — covers most PDFs.

function inflate(data: Uint8Array): Uint8Array {
  // Skip zlib header (2 bytes) if present
  let offset = 0;
  if (data.length > 2 && (data[0] & 0x0F) === 8) {
    offset = 2; // skip CMF + FLG
  }

  const output: number[] = [];
  const bits = new BitReader(data, offset);

  let bfinal = 0;
  while (!bfinal) {
    bfinal = bits.read(1);
    const btype = bits.read(2);

    if (btype === 0) {
      // Uncompressed block
      bits.alignToByte();
      const len = bits.read(16);
      bits.read(16); // nlen (complement, skip)
      for (let i = 0; i < len; i++) {
        output.push(bits.read(8));
      }
    } else if (btype === 1 || btype === 2) {
      // Huffman compressed
      let litLenTree: HuffmanTree;
      let distTree: HuffmanTree;

      if (btype === 1) {
        litLenTree = buildFixedLitLenTree();
        distTree = buildFixedDistTree();
      } else {
        [litLenTree, distTree] = buildDynamicTrees(bits);
      }

      while (true) {
        const sym = decodeSymbol(bits, litLenTree);
        if (sym === 256) break; // end of block
        if (sym < 256) {
          output.push(sym);
        } else {
          // Length/distance pair
          const length = decodeLength(sym, bits);
          const distSym = decodeSymbol(bits, distTree);
          const distance = decodeDistance(distSym, bits);
          for (let i = 0; i < length; i++) {
            output.push(output[output.length - distance]);
          }
        }
      }
    } else {
      throw new Error('Invalid DEFLATE block type');
    }
  }

  return new Uint8Array(output);
}

// ── Bit reader ───────────────────────────────────────────────

class BitReader {
  private data: Uint8Array;
  private bytePos: number;
  private bitPos: number;

  constructor(data: Uint8Array, offset: number) {
    this.data = data;
    this.bytePos = offset;
    this.bitPos = 0;
  }

  read(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      if (this.bytePos >= this.data.length) return value;
      const bit = (this.data[this.bytePos] >> this.bitPos) & 1;
      value |= bit << i;
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
    }
    return value;
  }

  alignToByte() {
    if (this.bitPos > 0) {
      this.bitPos = 0;
      this.bytePos++;
    }
  }
}

// ── Huffman tree ─────────────────────────────────────────────

interface HuffmanTree {
  children: (HuffmanTree | number)[];
}

function buildTreeFromLengths(lengths: number[], maxSym: number): HuffmanTree {
  const maxLen = Math.max(...lengths.filter(l => l > 0), 1);
  const blCount = new Array(maxLen + 1).fill(0);
  for (let i = 0; i <= maxSym; i++) {
    if (lengths[i]) blCount[lengths[i]]++;
  }

  const nextCode = new Array(maxLen + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  const root: HuffmanTree = { children: [] };
  for (let i = 0; i <= maxSym; i++) {
    const len = lengths[i];
    if (!len) continue;
    let node = root;
    for (let bit = len - 1; bit >= 0; bit--) {
      const b = (nextCode[len] >> bit) & 1;
      if (!node.children[b]) {
        node.children[b] = { children: [] };
      }
      if (bit === 0) {
        node.children[b] = i;
      } else {
        node = node.children[b] as HuffmanTree;
      }
    }
    nextCode[len]++;
  }

  return root;
}

function decodeSymbol(bits: BitReader, tree: HuffmanTree): number {
  let node = tree;
  for (let i = 0; i < 30; i++) { // safety limit
    const b = bits.read(1);
    const next = node.children[b];
    if (typeof next === 'number') return next;
    if (!next) throw new Error('Invalid Huffman code');
    node = next;
  }
  throw new Error('Huffman decode exceeded depth');
}

function buildFixedLitLenTree(): HuffmanTree {
  const lengths = new Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return buildTreeFromLengths(lengths, 287);
}

function buildFixedDistTree(): HuffmanTree {
  const lengths = new Array(32).fill(5);
  return buildTreeFromLengths(lengths, 31);
}

function buildDynamicTrees(bits: BitReader): [HuffmanTree, HuffmanTree] {
  const hlit = bits.read(5) + 257;
  const hdist = bits.read(5) + 1;
  const hclen = bits.read(4) + 4;

  const codeLenOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codeLenLengths = new Array(19).fill(0);
  for (let i = 0; i < hclen; i++) {
    codeLenLengths[codeLenOrder[i]] = bits.read(3);
  }

  const codeLenTree = buildTreeFromLengths(codeLenLengths, 18);

  const allLengths: number[] = [];
  while (allLengths.length < hlit + hdist) {
    const sym = decodeSymbol(bits, codeLenTree);
    if (sym < 16) {
      allLengths.push(sym);
    } else if (sym === 16) {
      const rep = bits.read(2) + 3;
      const prev = allLengths[allLengths.length - 1] ?? 0;
      for (let i = 0; i < rep; i++) allLengths.push(prev);
    } else if (sym === 17) {
      const rep = bits.read(3) + 3;
      for (let i = 0; i < rep; i++) allLengths.push(0);
    } else if (sym === 18) {
      const rep = bits.read(7) + 11;
      for (let i = 0; i < rep; i++) allLengths.push(0);
    }
  }

  const litLenTree = buildTreeFromLengths(allLengths.slice(0, hlit), hlit - 1);
  const distTree = buildTreeFromLengths(allLengths.slice(hlit, hlit + hdist), hdist - 1);

  return [litLenTree, distTree];
}

// ── Length / distance tables ─────────────────────────────────

const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];

function decodeLength(sym: number, bits: BitReader): number {
  const idx = sym - 257;
  return LEN_BASE[idx] + bits.read(LEN_EXTRA[idx]);
}

const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

function decodeDistance(sym: number, bits: BitReader): number {
  return DIST_BASE[sym] + bits.read(DIST_EXTRA[sym]);
}

console.log('[PDF] Pure-JS extractor loaded');
