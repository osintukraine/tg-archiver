#!/usr/bin/env python3
"""Audit an env file against docker-compose.yml and the code that reads it.

Static analysis only (stdlib + PyYAML). Prints variable NAMES, never values.

    python scripts/env_audit.py                     # audit .env
    python scripts/env_audit.py --env-file .env.example --strict
    python scripts/env_audit.py --json

Findings for names in the env file:
  RENAMED          an old name nothing reads any more; the finding names its replacement
  DEAD_NOT_PASSED  compose never references it and no host script reads it
  DEAD_UNREAD      compose passes it to a service, but that service never reads it
  UNUSED_SETTING   reaches a service as a Settings field that no code uses
Independent of the env file:
  MISSING_PASSTHROUGH  a service's code reads X but compose does not pass X
  SETTINGS_DECLARED_UNUSED  Settings fields nothing references (informational)

Limitations (heuristics, see README of each check in the code):
  * Settings fields count as "read" when code does `settings.X` / `getattr(settings, "X")`
    (any name containing settings/config/cfg), expanded through Settings properties/methods.
  * shared/python is credited to every Python service even if the service never imports
    the module (no import graph).
  * Dynamic env access (os.environ.items(), computed keys) is invisible.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

import yaml

# service -> where its code/scripts live. py/js dirs are scanned for env reads;
# sh files for $VAR / {$VAR} reads; image = vars the stock image itself consumes.
SERVICES: dict[str, dict] = {
    "listener": {"py": ["services/listener/src"]},
    "processor": {"py": ["services/processor/src"]},
    "api": {"py": ["services/api/src"]},
    "frontend": {"js": ["services/frontend"]},
    "seaweedfs": {"sh": ["infrastructure/seaweedfs/entrypoint.sh"]},
    "db-migrate": {
        "sh": ["infrastructure/postgres/migrate.sh"],
        "image": ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE"],
    },
    "postgres": {
        "image": ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "POSTGRES_INITDB_ARGS",
                  "POSTGRES_HOST_AUTH_METHOD", "PGDATA"],
    },
    "redis": {},
    "caddy": {"sh": ["infrastructure/caddy/Caddyfile"]},
}
PYTHON_SERVICES = [s for s, c in SERVICES.items() if "py" in c]
SHARED_PY = "shared/python"
SETTINGS_FILE = "shared/python/config/settings.py"
# Host scripts that load the env file directly: their reads are "host-only", not dead.
HOST_SCRIPTS = ["scripts"]
# Generic process vars: reading them never implies the operator should set them.
GENERIC = {"HOME", "PATH", "PWD", "USER", "HOSTNAME", "LANG", "TZ", "TERM", "SHELL", "PYTHONPATH", "CI",
           "NODE_ENV", "PORT", "NEXT_RUNTIME", "NEXT_TELEMETRY_DISABLED", "NEXT_PHASE", "VITEST", "NEXT_PUBLIC_VERSION"}
# Intentional exceptions: NAME -> reason. Keep tiny; every entry needs a reason.
ALLOW: dict[str, str] = {}
# Names that older .env files carry but nothing reads any more: OLD -> (NEW, why).
# Reported as RENAMED so a setting never silently stops working.
RENAMED: dict[str, tuple[str, str]] = {
    "SECRET_KEY": ("JWT_SECRET_KEY", "the OSINT platform signed JWTs with SECRET_KEY; tg-archiver reads JWT_SECRET_KEY"),
    "MINIO_BUCKET_NAME": ("MINIO_BUCKET", "compose maps MINIO_BUCKET to each service's MINIO_BUCKET_NAME"),
    "GAP_LOOKBACK_HOURS": ("GAP_THRESHOLD_HOURS", "gap detection never read GAP_LOOKBACK_HOURS"),
}

FAIL_KINDS = {"RENAMED", "DEAD_NOT_PASSED", "DEAD_UNREAD", "UNUSED_SETTING"}
SETTINGS_NAME = re.compile(r"settings|config|cfg", re.I)
HOST_VAR = re.compile(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)")
# Shared modules CLAUDE.md documents as unused; skipping them avoids crediting dead reads to every service.
UNUSED_SHARED = ("shared/python/database/", "shared/python/translation.py")
SKIP_DIRS = {"node_modules", ".next", "__pycache__", "tests", "__tests__", ".git", "test", "docs"}


# ---------------------------------------------------------------- env file
def parse_env_names(path: Path) -> list[str]:
    names = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if m:
            names.append(m.group(1))
    return names


# ---------------------------------------------------------------- file walking
def walk(base: Path, suffixes: tuple[str, ...]):
    if base.is_file():
        yield base
        return
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base).parts
        if p.is_file() and p.suffix in suffixes and not (set(rel[:-1]) & SKIP_DIRS) \
                and not re.search(r"\.(test|spec)\.|^test_|^vitest\.|conftest", p.name):
            yield p


# ---------------------------------------------------------------- compose
def parse_compose(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()
    doc = yaml.safe_load(raw) or {}
    out = {}
    for name, svc in (doc.get("services") or {}).items():
        svc = svc or {}
        env = svc.get("environment") or {}
        if isinstance(env, list):
            pairs = [e.split("=", 1) if "=" in e else [e, f"${{{e}}}"] for e in map(str, env)]
        else:
            pairs = [[k, "" if v is None else str(v)] for k, v in env.items()]
        build = svc.get("build")
        args = build.get("args") if isinstance(build, dict) else None
        if isinstance(args, list):
            pairs += [a.split("=", 1) if "=" in a else [a, f"${{{a}}}"] for a in map(str, args)]
        elif isinstance(args, dict):
            pairs += [[k, "" if v is None else str(v)] for k, v in args.items()]
        passes = {k: sorted(set(HOST_VAR.findall(v.replace("$$", "")))) for k, v in pairs}
        other = dict(svc)
        other.pop("environment", None)
        if isinstance(other.get("build"), dict):
            other["build"] = {k: v for k, v in other["build"].items() if k != "args"}
        text = json.dumps(other, default=str).replace("$$", "")
        out[name] = {"passes": passes, "other_vars": set(HOST_VAR.findall(text)), "line": _svc_line(lines, name)}
    out["__lines__"] = lines
    return out


def _svc_line(lines: list[str], name: str) -> int:
    for i, ln in enumerate(lines, 1):
        if re.match(rf"^  {re.escape(name)}:\s*$", ln):
            return i
    return 0


def compose_line(comp: dict, svc: str, key: str) -> int:
    lines, start = comp["__lines__"], comp[svc]["line"]
    for i in range(start, len(lines)):
        if i > start and re.match(r"^  \S", lines[i]) and not lines[i].startswith("  #"):
            break  # next service
        if re.search(rf"(^|[\s\-]){re.escape(key)}\s*[=:]", lines[i]):
            return i + 1
    return start


# ---------------------------------------------------------------- python reads
def _is_environ(node: ast.AST) -> bool:
    return (isinstance(node, ast.Attribute) and node.attr == "environ") or (
        isinstance(node, ast.Name) and node.id == "environ")


def _const(node: ast.AST) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def scan_python(path: Path, root: Path) -> tuple[dict[str, list[str]], dict[str, set[str]]]:
    """Return (os env reads {NAME: [file:line]}, settings attribute refs {attr: {file:line}})."""
    env: dict[str, list[str]] = {}
    refs: dict[str, set[str]] = {}
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return env, refs
    rel = path.relative_to(root).as_posix()
    for n in ast.walk(tree):
        name = None
        if isinstance(n, ast.Call) and n.args:
            f = n.func
            if isinstance(f, ast.Attribute) and f.attr in ("get", "getenv") and (
                    _is_environ(f.value) or (f.attr == "getenv" and isinstance(f.value, ast.Name) and f.value.id == "os")):
                name = _const(n.args[0])
            elif isinstance(f, ast.Name) and f.id == "getenv":
                name = _const(n.args[0])
            elif isinstance(f, ast.Name) and f.id in ("getattr", "hasattr") and len(n.args) >= 2 \
                    and isinstance(n.args[0], (ast.Name, ast.Attribute)) and SETTINGS_NAME.search(ast.unparse(n.args[0])):
                a = _const(n.args[1])
                if a:
                    refs.setdefault(a, set()).add(f"{rel}:{n.lineno}")
        elif isinstance(n, ast.Subscript) and _is_environ(n.value):
            name = _const(n.slice)
        elif isinstance(n, ast.Compare) and any(_is_environ(c) for c in n.comparators):
            name = _const(n.left)
        elif isinstance(n, ast.Attribute) and SETTINGS_NAME.search(ast.unparse(n.value)):
            refs.setdefault(n.attr, set()).add(f"{rel}:{n.lineno}")
        if name:
            env.setdefault(name, []).append(f"{rel}:{n.lineno}")
    return env, refs


def parse_settings(root: Path) -> dict:
    """Settings fields (name -> env name, line) and method closure (method -> fields it touches)."""
    path = root / SETTINGS_FILE
    fields: dict[str, int] = {}
    methods: dict[str, set[str]] = {}
    if not path.exists():
        return {"fields": fields, "methods": methods, "line": {}}
    tree = ast.parse(path.read_text(encoding="utf-8"))
    cls = next((n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Settings"), None)
    for item in cls.body if cls else []:
        if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name) and item.target.id.isupper():
            env_name = item.target.id
            if isinstance(item.value, ast.Call):  # Field(alias="X") replaces the env name
                for kw in item.value.keywords:
                    if kw.arg in ("alias", "validation_alias") and _const(kw.value):
                        env_name = _const(kw.value)
            fields[env_name] = item.lineno
        elif isinstance(item, ast.FunctionDef):
            methods[item.name] = {
                a.attr for a in ast.walk(item)
                if isinstance(a, ast.Attribute) and isinstance(a.value, ast.Name) and a.value.id == "self"}
    return {"fields": fields, "methods": methods}


def expand(attrs: dict[str, set[str]], settings: dict) -> dict[str, set[str]]:
    """Expand refs to Settings methods/properties into the fields they use (transitively)."""
    out = {k: set(v) for k, v in attrs.items()}
    methods = settings["methods"]
    todo = [m for m in attrs if m in methods]
    seen = set()
    while todo:
        m = todo.pop()
        if m in seen:
            continue
        seen.add(m)
        for a in methods[m]:
            out.setdefault(a, set()).update(attrs[m] if m in attrs else out.get(m, set()))
            if a in methods:
                todo.append(a)
    return out


# ---------------------------------------------------------------- other languages
def scan_js(base: Path, root: Path) -> dict[str, list[str]]:
    pat = re.compile(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)|process\.env\[\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\s*\]")
    out: dict[str, list[str]] = {}
    for p in walk(base, (".ts", ".tsx", ".js", ".jsx", ".mjs")):
        for i, ln in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for m in pat.finditer(ln):
                out.setdefault(m.group(1) or m.group(2), []).append(f"{p.relative_to(root).as_posix()}:{i}")
    return out


def scan_shell(path: Path, root: Path) -> dict[str, list[str]]:
    """$VAR / ${VAR} / Caddy {$VAR} reads, minus names the script assigns itself."""
    text = path.read_text(encoding="utf-8", errors="replace")
    assigned = set(re.findall(r"^\s*(?:export\s+)?([A-Za-z_]\w*)=", text, re.M)) | set(re.findall(r"\bfor\s+(\w+)\s+in\b", text))
    out: dict[str, list[str]] = {}
    for i, ln in enumerate(text.splitlines(), 1):
        if ln.lstrip().startswith("#"):
            continue
        for v in re.findall(r"\$\{?([A-Z_][A-Z0-9_]*)", ln.replace("{$", "${")):
            if v not in assigned:
                out.setdefault(v, []).append(f"{path.relative_to(root).as_posix()}:{i}")
    return out


# ---------------------------------------------------------------- audit
def collect_reads(root: Path, settings: dict) -> dict:
    """Per service: {'env': {NAME: [evidence]}, 'settings': {FIELD: [evidence]}}."""
    shared_env: dict[str, list[str]] = {}
    shared_refs: dict[str, set[str]] = {}
    shared_dir = root / SHARED_PY
    for p in walk(shared_dir, (".py",)) if shared_dir.exists() else []:
        if p.relative_to(root).as_posix().startswith(UNUSED_SHARED):
            continue
        e, r = scan_python(p, root)
        for k, v in e.items():
            shared_env.setdefault(k, []).extend(v)
        if p.relative_to(root).as_posix() != SETTINGS_FILE:  # settings.py self-refs only count via methods
            for k, v in r.items():
                shared_refs.setdefault(k, set()).update(v)
    reads: dict[str, dict] = {}
    for svc, cfg in SERVICES.items():
        env: dict[str, list[str]] = {}
        refs: dict[str, set[str]] = {}
        for d in cfg.get("py", []):
            for p in walk(root / d, (".py",)) if (root / d).exists() else []:
                e, r = scan_python(p, root)
                for k, v in e.items():
                    env.setdefault(k, []).extend(v)
                for k, v in r.items():
                    refs.setdefault(k, set()).update(v)
        if "py" in cfg:
            for k, v in shared_env.items():
                env.setdefault(k, []).extend(v)
            for k, v in shared_refs.items():
                refs.setdefault(k, set()).update(v)
        for d in cfg.get("js", []):
            if (root / d).exists():
                env.update(scan_js(root / d, root))
        for f in cfg.get("sh", []):
            if (root / f).exists():
                env.update(scan_shell(root / f, root))
        for v in cfg.get("image", []):
            env.setdefault(v, []).append(f"image:{svc}")
        refs = expand(refs, settings)
        fset = {k: sorted(v)[:2] for k, v in refs.items() if k in settings["fields"]}
        reads[svc] = {"env": env, "settings": fset}
    return reads


def host_script_reads(root: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for d in HOST_SCRIPTS:
        for p in walk(root / d, (".py",)) if (root / d).exists() else []:
            for k, v in scan_python(p, root)[0].items():
                out.setdefault(k, []).extend(v)
    return out


def reader_evidence(reads: dict, svc: str, key: str) -> list[str] | None:
    r = reads.get(svc)
    if not r:
        return None
    return r["env"].get(key) or r["settings"].get(key)


def audit(root: Path, env_file: Path, compose_file: Path) -> dict:
    settings = parse_settings(root)
    comp = parse_compose(compose_file)
    reads = collect_reads(root, settings)
    host = host_script_reads(root)
    all_refs = {k for r in reads.values() for k in r["settings"]}
    findings: list[dict] = []

    def add(kind, name, detail, evidence=()):
        reason = ALLOW.get(name)
        findings.append({"kind": kind, "name": name, "detail": detail, "evidence": list(evidence)[:6],
                         "allowed": reason})

    for name in dict.fromkeys(parse_env_names(env_file)):
        receivers = []  # (service, container key)
        compose_used = [s for s, c in comp.items() if s != "__lines__" and name in c["other_vars"]]
        for s, c in comp.items():
            if s == "__lines__":
                continue
            receivers += [(s, k) for k, hv in c["passes"].items() if name in hv]
        ok_via = [f"{s} reads {k}" for s, k in receivers if reader_evidence(reads, s, k)]
        evidence = [f"{s}:{k} -> docker-compose.yml:{compose_line(comp, s, k)}" for s, k in receivers]
        if ok_via or compose_used or name in host:
            how = list(ok_via)
            if compose_used:
                how.append(f"compose uses it in {', '.join(compose_used)}")
            if name in host:
                how.append(f"host script ({host[name][0]})")
            add("OK", name, "; ".join(how), evidence)
        elif name in RENAMED:
            new, why = RENAMED[name]
            add("RENAMED", name, f"has no effect; set {new} instead ({why})")
        elif not receivers:
            literal = [s for s, c in comp.items() if s != "__lines__" and name in c["passes"]]
            hint = f" (compose sets {name} literally in {', '.join(literal)}, ignoring .env)" if literal else ""
            add("DEAD_NOT_PASSED", name, "not referenced by docker-compose.yml or host scripts" + hint)
        else:
            unused = [(s, k) for s, k in receivers if k in settings["fields"] and k not in all_refs
                      and k not in reads.get(s, {"env": {}})["env"]]
            if unused:
                add("UNUSED_SETTING", name,
                    "reaches " + ", ".join(f"{s} as {k}" for s, k in unused) + " but the Settings field is never used",
                    [f"{SETTINGS_FILE}:{settings['fields'][k]}" for _, k in unused] + evidence)
            else:
                add("DEAD_UNREAD", name, "passed to " + ", ".join(f"{s} as {k}" for s, k in receivers)
                    + " but no receiving service reads it", evidence)

    missing: dict[str, dict[str, list[str]]] = {}
    for svc in PYTHON_SERVICES + ["frontend"]:
        passed = set(comp.get(svc, {"passes": {}})["passes"])
        for key in set(reads[svc]["env"]) | set(reads[svc]["settings"]):
            if key not in passed and key not in GENERIC:
                missing.setdefault(key, {})[svc] = reads[svc]["env"].get(key) or reads[svc]["settings"].get(key)
    for key, by_svc in sorted(missing.items()):
        add("MISSING_PASSTHROUGH", key, f"read by {', '.join(by_svc)} but docker-compose.yml does not pass it (default applies)",
            [f"{svc}: {ev[0]}" for svc, ev in by_svc.items()])
    for f, ln in sorted(settings["fields"].items(), key=lambda x: x[1]):
        if f not in all_refs and not any(f in r["env"] for r in reads.values()):
            add("SETTINGS_DECLARED_UNUSED", f, "Settings field never referenced", [f"{SETTINGS_FILE}:{ln}"])
    return {"env_file": env_file.name, "findings": findings}


# ---------------------------------------------------------------- output
ORDER = ["RENAMED", "DEAD_NOT_PASSED", "DEAD_UNREAD", "UNUSED_SETTING", "MISSING_PASSTHROUGH", "SETTINGS_DECLARED_UNUSED", "OK"]


def render(result: dict) -> str:
    out = [f"env audit of {result['env_file']} (names only, values never read)"]
    for kind in ORDER:
        items = [f for f in result["findings"] if f["kind"] == kind]
        if not items:
            continue
        out.append(f"\n== {kind} ({len(items)}) ==")
        if kind == "SETTINGS_DECLARED_UNUSED":
            out.append("  " + ", ".join(f["name"] for f in items))
            continue
        for f in items:
            note = f"  [allowed: {f['allowed']}]" if f["allowed"] else ""
            out.append(f"  {f['name']}: {f['detail']}{note}")
            if kind != "OK":
                out.extend(f"      {e}" for e in f["evidence"])
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    root_default = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=".env")
    ap.add_argument("--compose", default="docker-compose.yml")
    ap.add_argument("--root", default=str(root_default))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true", help="exit 1 on RENAMED/DEAD_*/UNUSED_SETTING")
    a = ap.parse_args(argv)
    root = Path(a.root)
    env = Path(a.env_file) if Path(a.env_file).is_absolute() else Path.cwd() / a.env_file
    if not env.exists():
        env = root / a.env_file
    compose = root / a.compose
    for p in (env, compose):
        if not p.exists():
            print(f"error: {p} not found", file=sys.stderr)
            return 2
    result = audit(root, env, compose)
    print(json.dumps(result, indent=2) if a.json else render(result))
    bad = [f for f in result["findings"] if f["kind"] in FAIL_KINDS and not f["allowed"]]
    return 1 if a.strict and bad else 0


if __name__ == "__main__":
    sys.exit(main())
