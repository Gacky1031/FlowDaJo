#!/usr/bin/env python3
"""Make the staged Homebrew R runtime independent of its build machine paths."""

import os
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path


runtime = Path(sys.argv[1]).resolve()
source_home = Path(sys.argv[2]).resolve()
dependencies = runtime / "lib" / "deps"
mach_o_magic = {
    b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
}


def is_mach_o(path):
    if not path.is_file() or path.is_symlink() or path.suffix == ".class":
        return False
    with path.open("rb") as handle:
        return handle.read(4) in mach_o_magic


def bundled_path(name):
    source = Path(name).resolve(strict=True)
    if source.is_relative_to(source_home):
        return runtime / source.relative_to(source_home)
    # The short name leaves room for install_name_tool in Mach-O load commands.
    suffix = hashlib.sha256(str(source).encode()).hexdigest()[:8]
    target = dependencies / f"{suffix}-{source.name}"
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    return target


def linked_libraries(path):
    output = subprocess.check_output(["otool", "-L", str(path)], text=True)
    names = [line.strip().split(" (")[0] for line in output.splitlines()[1:]
             if line.startswith("\t")]
    identity_output = subprocess.check_output(["otool", "-D", str(path)], text=True)
    identity_lines = identity_output.splitlines()
    identity = identity_lines[1] if len(identity_lines) > 1 else None
    if identity and names and names[0] == identity:
        names.pop(0)
    return identity, names


def change_install_name(*args):
    result = subprocess.run(["install_name_tool", *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"install_name_tool failed for {args[-1]}: {result.stderr}")


queue = [path for path in runtime.rglob("*") if is_mach_o(path)]
visited = set()
origins = {}
changed = 0
while queue:
    binary = queue.pop()
    if binary in visited:
        continue
    visited.add(binary)
    replacements = []
    identity, libraries = linked_libraries(binary)
    for old in libraries:
        if old.startswith(("/usr/lib/", "/System/Library/")):
            continue
        if old.startswith("/"):
            target = bundled_path(old)
            origins.setdefault(target, Path(old).resolve())
            if not target.is_file():
                raise RuntimeError(f"Missing bundled library for {binary}: {old}")
            if is_mach_o(target) and target not in visited:
                queue.append(target)
            new = "@loader_path/" + os.path.relpath(target, binary.parent)
            replacements.append((old, new))
        elif old.startswith("@loader_path/"):
            target = (binary.parent / old.removeprefix("@loader_path/")).resolve()
            if not target.is_file():
                original = origins.get(binary)
                if original is None:
                    raise RuntimeError(f"Missing relative library in {binary}: {old}")
                source = (original.parent / old.removeprefix("@loader_path/")).resolve(strict=True)
                target = bundled_path(str(source))
                origins.setdefault(target, source)
                replacements.append((old, "@loader_path/" + os.path.relpath(target, binary.parent)))
            if is_mach_o(target) and target not in visited:
                queue.append(target)
        elif old.startswith("@rpath/"):
            original = origins.get(binary)
            if original is None:
                raise RuntimeError(f"Cannot resolve rpath in {binary}: {old}")
            source = (original.parent / old.removeprefix("@rpath/")).resolve(strict=True)
            target = bundled_path(str(source))
            origins.setdefault(target, source)
            replacements.append((old, "@loader_path/" + os.path.relpath(target, binary.parent)))
            if is_mach_o(target) and target not in visited:
                queue.append(target)
        elif old.startswith("@executable_path/"):
            raise RuntimeError(f"Unresolved executable path in {binary}: {old}")
        else:
            raise RuntimeError(f"Unrecognized library reference in {binary}: {old}")
    new_identity = "@loader_path/" + binary.name if identity and identity.startswith("/") else None
    if replacements or new_identity:
        binary.chmod(binary.stat().st_mode | 0o200)
        if new_identity:
            change_install_name("-id", new_identity, str(binary))
        for old, new in replacements:
            change_install_name("-change", old, new, str(binary))
        subprocess.run(["codesign", "--force", "--sign", "-", str(binary)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        changed += 1

print(f"Relocated {changed} Mach-O files; bundled libraries: {len(list(dependencies.rglob('*.dylib')))}")
