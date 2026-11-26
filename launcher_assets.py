import base64
import json
from struct import pack, unpack_from
from zlib import compress, crc32


def read_resource(path, kind, key):
    if path is None:
        return None
    data = path.read_bytes()
    if len(data) < 8:
        return None
    table = unpack_from("<I", data, 4)[0]
    if table > len(data) - 4:
        return None
    count = unpack_from("<I", data, table)[0]
    if count > (len(data) - table - 4) // 12:
        return None
    resources = [unpack_from("<III", data, table + 4 + i * 12) for i in range(count)]
    for entry_kind, offset, entry_key in resources:
        if (entry_kind, entry_key) == (kind, key) and offset < table:
            end = min((other for _, other, _ in resources if offset < other < table), default=table)
            return data[offset:end]
    return None


def rgb565(color):
    return (((color >> 11) & 31) * 255 // 31,
            ((color >> 5) & 63) * 255 // 63,
            (color & 31) * 255 // 31)


def png(width, height, rows, color_type):
    def chunk(kind, data):
        return pack(">I", len(data)) + kind + data + pack(">I", crc32(kind + data))

    header = pack(">2I5B", width, height, 8, color_type, 0, 0, 0)
    pixels = compress(b"".join(b"\0" + row for row in rows))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")


def load_launcher_art(path):
    texture = read_resource(path, 350, 0)
    if not texture or len(texture) < 0x80 or texture[:4] != b"xb\x05\0":
        return None
    width, height = unpack_from("<II", texture, 4)
    format_id = (unpack_from("<I", texture, 0x38)[0] >> 8) & 0xff
    if (width, height, format_id) != (512, 256, 0x0c) or len(texture) < 0x80 + width * height // 2:
        return None
    rows = [bytearray(width * 3) for _ in range(height)]
    offset = 0x80
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            left, right, indices = unpack_from("<HHI", texture, offset)
            offset += 8
            a, b = rgb565(left), rgb565(right)
            if left > right:
                palette = (a, b, tuple((2 * p + q) // 3 for p, q in zip(a, b)),
                           tuple((p + 2 * q) // 3 for p, q in zip(a, b)))
            else:
                palette = (a, b, tuple((p + q) // 2 for p, q in zip(a, b)), (0, 0, 0))
            for dy in range(4):
                for dx in range(4):
                    start = (x + dx) * 3
                    rows[y + dy][start:start + 3] = bytes(palette[indices & 3])
                    indices >>= 2
    return png(width, height, rows, 2)


def load_launcher_ring(path):
    rows = [bytearray(64 * 4) for _ in range(64)]
    for key in (2, 3):
        texture = read_resource(path, 350, key)
        if not texture or len(texture) < 0x40 or texture[:4] != b"xb\x05\0":
            return None
        width, height = unpack_from("<II", texture, 4)
        offset, _, flags = unpack_from("<III", texture, 0x30)
        if (width, height, (flags >> 8) & 0xff) != (64, 64, 0x0f) or offset + 4096 > len(texture):
            return None
        for y in range(0, 64, 4):
            for x in range(0, 64, 4):
                alpha0, alpha1 = unpack_from("<BB", texture, offset)
                alpha_indices = int.from_bytes(texture[offset + 2:offset + 8], "little")
                left, right, indices = unpack_from("<HHI", texture, offset + 8)
                offset += 16
                if alpha0 > alpha1:
                    alphas = [alpha0, alpha1] + [((7 - i) * alpha0 + i * alpha1) // 7 for i in range(1, 7)]
                else:
                    alphas = [alpha0, alpha1] + [((5 - i) * alpha0 + i * alpha1) // 5 for i in range(1, 5)] + [0, 255]
                a, b = rgb565(left), rgb565(right)
                palette = (a, b, tuple((2 * p + q) // 3 for p, q in zip(a, b)),
                           tuple((p + 2 * q) // 3 for p, q in zip(a, b)))
                for dy in range(4):
                    for dx in range(4):
                        alpha = alphas[alpha_indices & 7]
                        start = (x + dx) * 4
                        if alpha > rows[y + dy][start + 3]:
                            rows[y + dy][start:start + 4] = bytes((*palette[indices & 3], alpha))
                        alpha_indices >>= 3
                        indices >>= 2
    return png(52, 56, [row[3 * 4:55 * 4] for row in rows[:56]], 6)


def load_launcher_font(path):
    font = read_resource(path, 800, 1)
    if not font or len(font) < 16 or not font.startswith(b"XF\x01\0"):
        return None
    range_count, height, range_offset = unpack_from("<HHI", font, 8)
    if range_count != 1 or height != 26 or range_offset > len(font) - 12:
        return None
    count, first, glyph_offset = unpack_from("<III", font, range_offset)
    if (first, count) != (32, 224):
        return None
    glyph_end = glyph_offset + count * 20
    texture = (glyph_end + 127) & ~127
    if font[texture:texture + 4] != b"xb\x05\0" or texture + 0x40 > len(font):
        return None
    width, atlas_height = unpack_from("<II", font, texture + 4)
    format_id = (unpack_from("<I", font, texture + 0x38)[0] >> 8) & 0xff
    if (width, atlas_height, format_id) != (256, 512, 0x19):
        return None
    glyphs = [unpack_from("<4I2H", font, glyph_offset + i * 20)[:5] for i in range(count)]
    interleaved = [sum(((value >> i) & 1) << (2 * i) for i in range(8)) for value in range(256)]
    start = texture + unpack_from("<I", font, texture + 0x30)[0]
    pixels = font[start:start + width * atlas_height]
    if len(pixels) != width * atlas_height:
        return None
    rows = []
    coverage = bytes(min(255, max(0, (value - 16) * 255 // 218)) for value in range(256))
    for y in range(atlas_height):
        swizzled_y = ((y & 256) << 8) | (interleaved[y & 255] << 1)
        row = bytearray(b"\xff\0" * width)
        row[1::2] = bytes(pixels[swizzled_y | swizzled_x] for swizzled_x in interleaved).translate(coverage)
        rows.append(row)
    atlas = base64.b64encode(png(width, atlas_height, rows, 4)).decode("ascii")
    return json.dumps({"first": first, "height": height, "glyphs": glyphs, "atlas": atlas},
                      separators=(",", ":")).encode()
