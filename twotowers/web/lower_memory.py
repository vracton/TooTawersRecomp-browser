import argparse
import re
from pathlib import Path


TOKEN = re.compile(r'''/\*[^\n]*?\*/|//[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\bMEM(8|16|32)\(''')
ASSIGNMENT = re.compile(r"\s*((?:<<|>>|[+*/%&|^\-])?=)(?!=)")


def closing_paren(line, start):
    depth = 1
    for index in range(start, len(line)):
        if line[index] == "(":
            depth += 1
        elif line[index] == ")":
            depth -= 1
            if not depth:
                return index
    raise ValueError("Unclosed guest address expression")


def value_end(line, start):
    depth = 0
    for index in range(start, len(line)):
        character = line[index]
        if character in "([":
            depth += 1
        elif character in ")]":
            if not depth:
                return index
            depth -= 1
        elif character in ";," and not depth:
            return index
    raise ValueError("Unclosed guest store expression")


def lower_line(line):
    if "MEM" not in line:
        return line
    for token in reversed(list(TOKEN.finditer(line))):
        width = token[1]
        if width is None:
            continue
        start = token.start()
        end = closing_paren(line, token.end())
        address = line[token.end():end]
        assignment = ASSIGNMENT.match(line, end + 1)
        if assignment:
            operator = assignment[1][:-1]
            end = value_end(line, assignment.end())
            value = line[assignment.end():end].strip()
            if operator:
                change = f"RECOMP_WEB_UPDATE({width}, {address}, {operator}, {value})"
            else:
                change = f"recomp_web_write{width}({address}, {value})"
            line = line[:start] + change + line[end:]
        elif re.match(r"\s*(?:\+\+|--)", line[end + 1:]):
            raise ValueError("Unexpected increment of guest memory")
        else:
            prefix = line[:start]
            if prefix.endswith("&") and not prefix.endswith("&&"):
                continue
            line = line[:start] + f"recomp_web_read{width}({address})" + line[end + 1:]
    return line


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with args.source.open(encoding="utf-8") as source, args.output.open("w", encoding="utf-8", newline="\n") as output:
        for number, line in enumerate(source, 1):
            try:
                output.write(lower_line(line))
            except ValueError as error:
                raise ValueError(f"{args.source}:{number}: {error}") from error


if __name__ == "__main__":
    main()
