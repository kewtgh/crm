"use strict";

const supportedTypes = Object.freeze(["gif", "ico", "jpg", "png", "svg", "webp"]);
let disabledTypes = new Set();

function fail() {
  throw new TypeError("Unsupported or invalid image metadata format");
}

function bytesFrom(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return fail();
}

function ensure(bytes, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > bytes.length) fail();
}

function ascii(bytes, offset, length) {
  ensure(bytes, offset, length);
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function uint16BE(bytes, offset) {
  ensure(bytes, offset, 2);
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint16LE(bytes, offset) {
  ensure(bytes, offset, 2);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint24LE(bytes, offset) {
  ensure(bytes, offset, 3);
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32BE(bytes, offset) {
  ensure(bytes, offset, 4);
  return ((bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]) >>> 0;
}

function positiveDimensions(width, height, extras = {}) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0) fail();
  return { width, height, ...extras };
}

function parsePng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  if (ascii(bytes, 12, 4) !== "IHDR") fail();
  return positiveDimensions(uint32BE(bytes, 16), uint32BE(bytes, 20));
}

function parseGif(bytes) {
  if (bytes.length < 10 || !/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return null;
  return positiveDimensions(uint16LE(bytes, 6), uint16LE(bytes, 8));
}

function parseIco(bytes) {
  if (bytes.length < 6 || uint16LE(bytes, 0) !== 0 || uint16LE(bytes, 2) !== 1) return null;
  const count = uint16LE(bytes, 4);
  if (count < 1 || count > 256) fail();
  ensure(bytes, 6, count * 16);
  const images = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    images.push({
      width: bytes[offset] === 0 ? 256 : bytes[offset],
      height: bytes[offset + 1] === 0 ? 256 : bytes[offset + 1],
    });
  }
  const largest = images.reduce((current, candidate) => (
    candidate.width * candidate.height > current.width * current.height ? candidate : current
  ));
  return positiveDimensions(largest.width, largest.height, count > 1 ? { images } : {});
}

function parseJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) fail();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    ensure(bytes, offset, 1);
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) fail();
    const segmentLength = uint16BE(bytes, offset);
    if (segmentLength < 2) fail();
    ensure(bytes, offset, segmentLength);
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) fail();
      return positiveDimensions(uint16BE(bytes, offset + 5), uint16BE(bytes, offset + 3));
    }
    offset += segmentLength;
  }
  return fail();
}

function parseWebp(bytes) {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return positiveDimensions(1 + uint24LE(bytes, 24), 1 + uint24LE(bytes, 27));
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) fail();
    const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
    const height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6));
    return positiveDimensions(width, height);
  }
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) fail();
    return positiveDimensions(uint16LE(bytes, 26) & 0x3fff, uint16LE(bytes, 28) & 0x3fff);
  }
  return fail();
}

function parseSvgLength(value) {
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:px)?$/.exec(value ?? "");
  if (!match) return null;
  const parsed = Math.round(Number(match[1]));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSvg(bytes) {
  const probeLength = Math.min(bytes.length, 64 * 1024);
  const source = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, probeLength));
  const root = /<svg\b[^>]{0,8192}>/i.exec(source)?.[0];
  if (!root) return null;
  let width = parseSvgLength(/\bwidth\s*=\s*["']([^"']+)["']/i.exec(root)?.[1]);
  let height = parseSvgLength(/\bheight\s*=\s*["']([^"']+)["']/i.exec(root)?.[1]);
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(root)?.[1]
    ?.trim().split(/[\s,]+/).map(Number);
  if ((!width || !height) && viewBox?.length === 4
    && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    if (!width && !height) {
      width = Math.round(viewBox[2]);
      height = Math.round(viewBox[3]);
    } else if (!width) {
      width = Math.round(height * viewBox[2] / viewBox[3]);
    } else if (!height) {
      height = Math.round(width * viewBox[3] / viewBox[2]);
    }
  }
  return positiveDimensions(width, height);
}

const parsers = [
  ["png", parsePng],
  ["gif", parseGif],
  ["ico", parseIco],
  ["jpg", parseJpeg],
  ["webp", parseWebp],
  ["svg", parseSvg],
];

function imageSize(input) {
  const bytes = bytesFrom(input);
  for (const [type, parse] of parsers) {
    const result = parse(bytes);
    if (!result) continue;
    if (disabledTypes.has(type)) fail();
    return { ...result, type };
  }
  return fail();
}

function disableTypes(types) {
  if (!Array.isArray(types) || types.some((type) => !supportedTypes.includes(type))) fail();
  disabledTypes = new Set(types);
}

module.exports = {
  default: imageSize,
  disableTypes,
  imageSize,
  types: supportedTypes,
};
