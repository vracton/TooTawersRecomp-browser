"""
What recomp_manual.c defines.

Single source of truth, deliberately. Both the recompiler (deciding what NOT to
generate) and gen_dangling_stubs.py (deciding what still needs a stub) have to
agree on what counts as a definition. When they each had their own regex they
disagreed, and every disagreement is a link error: a definition missed by one
becomes "already defined", a definition invented by the other becomes
"unresolved external".
"""

import os
import re
import sys

# A definition is "void sub_XXXXXXXX(void)" followed by a body -- on the same
# line (`void sub_X(void) { esp += 4; return; }`) or the next. A declaration
# ends in ';' and must not match.
DEF_RE = re.compile(r"\bvoid\s+(\w*?(?:sub_)?([0-9A-Fa-f]{8}))\s*\(\s*void\s*\)\s*\{")
_SUB_DEF_RE = re.compile(r"\bvoid\s+(sub_([0-9A-Fa-f]{8}))\s*\(\s*void\s*\)\s*\{")
# recomp_manual.c wraps rather than replaces some functions: it defines sub_X
# itself and calls the generated body as sub_X_gen.
_WRAP_RE = re.compile(r"\b(sub_([0-9A-Fa-f]{8}))_gen\b")


def _code_only(src):
    """Mask comments and literals without joining tokens or losing newlines."""
    tokens = r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\''
    return re.sub(tokens, lambda m: re.sub(r"[^\n]", " ", m.group()),
                  src, flags=re.S)


def _expand_definition_macros(src):
    """Expand local function macros that emit declarations/definitions.

    This is a source scanner, not a platform C preprocessor: leave unrelated
    expression macros and platform conditionals alone. Handle continued macro
    bodies, token pasting, and wrapper macros calling other wrapper macros.
    """
    src = re.sub(r"\\\r?\n", "", src)
    macros = {}
    pattern = re.compile(r"^[ \t]*#[ \t]*define[ \t]+(\w+)\(([^)\n]*)\)[ \t]*(.*)$", re.M)
    for m in pattern.finditer(src):
        params = [p.strip() for p in m[2].split(",") if p.strip()]
        if all(re.fullmatch(r"\w+", p) for p in params):
            macros[m[1]] = (params, m[3])
    selected = {name for name, (_, body) in macros.items()
                if re.search(r"\bvoid\b", body)}
    while True:
        parents = {name for name, (_, body) in macros.items()
                   if any(re.search(r"\b" + re.escape(child) + r"\s*\(", body)
                          for child in selected)}
        if parents <= selected:
            break
        selected |= parents
    # Never scan uninstantiated macro bodies as actual C definitions.
    src = re.sub(r"^[ \t]*#.*$", "", src, flags=re.M)
    if not selected:
        return src
    calls = re.compile(r"\b(" + "|".join(map(re.escape, sorted(selected))) + r")\s*\(")

    def expand(text, active=frozenset()):
        out, pos = [], 0
        for m in calls.finditer(text):
            if m.start() < pos or m[1] in active:
                continue
            depth, start, args = 1, m.end(), []
            end = start
            while end < len(text) and depth:
                ch = text[end]
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                if (ch == "," and depth == 1) or depth == 0:
                    args.append(text[start:end].strip())
                    start = end + 1
                end += 1
            params, body = macros[m[1]]
            if not params and args == [""]:
                args = []
            if depth or len(args) != len(params):
                continue
            values = dict(zip(params, args))
            body = re.sub(r"\b\w+\b", lambda t: values.get(t[0], t[0]), body)
            body = re.sub(r"\s*##\s*", "", body)
            out.extend((text[pos:m.start()], expand(body, active | {m[1]})))
            pos = end
        out.append(text[pos:])
        return "".join(out)

    return expand(src)


def _scan_text(path):
    return _expand_definition_macros(_code_only(read_live(path)))


def strip_disabled(src):
    """Remove '#if 0 ... #endif' regions.

    recomp_manual.c keeps disabled overrides around as documentation. A
    definition inside one is not a definition; counting it makes the
    recompiler skip a function that then nothing defines.
    """
    out, depth = [], 0
    for line in src.splitlines(keepends=True):
        s = line.strip()
        if re.match(r"^#if\s+0\b", s):
            depth += 1
        elif depth and re.match(r"^#if(def|ndef)?\b", s):
            depth += 1  # nested conditional inside a disabled block
        elif depth and s.startswith("#endif"):
            depth -= 1
        elif depth == 0:
            out.append(line)
    return "".join(out)


_INC_RE = re.compile(r'^[ \t]*#[ \t]*include\s+"([^"]+\.(?:inc|c))"', re.M)


def read_live(path):
    """The file's live text, with the local files it #includes (".inc" or
    ".c", next to it) read in at their place -- a project can keep its
    hand-written functions in several files."""
    live = strip_disabled(open(path, encoding="utf-8", errors="replace").read())
    base = os.path.dirname(path)

    def inc(m):
        p = os.path.join(base, m.group(1))
        return read_live(p) if os.path.exists(p) else m.group(0)
    return _INC_RE.sub(inc, live)


def definition_names(path):
    """Names of functions actually defined (compiled) in `path`."""
    if not os.path.exists(path):
        return set()
    live = _scan_text(path)
    return {m.group(1) for m in _SUB_DEF_RE.finditer(live)}


_REF_RE = re.compile(r"\bsub_([0-9A-Fa-f]{8})\b")


def scan(path):
    """(skip, wrap, referenced) for functions the manual file handles.

    skip:       defined by hand -- gen must declare but not define them.
    wrap:       manual calls the generated body as sub_X_gen -- gen must still
                emit it, renamed.
    referenced: every sub_XXXXXXXX the hand-written code mentions at all. Those
                must keep the sub_ name in the generated output: recomp_manual.c
                declares and calls sub_00350C10, so if a naming pass renamed it
                to SwapCopy_D3D_..., gen defines that and nothing defines
                sub_00350C10. Correctness beats a prettier name.
    """
    if not os.path.exists(path):
        print(f"WARNING: {path} not found; excluding nothing.", file=sys.stderr)
        return set(), set(), set()
    live = _scan_text(path)
    skip = {int(m.group(2), 16) for m in _SUB_DEF_RE.finditer(live)}
    wrap = {int(m.group(2), 16) for m in _WRAP_RE.finditer(live)}
    referenced = {int(m.group(1), 16) for m in _REF_RE.finditer(live)}
    return skip, wrap, referenced
