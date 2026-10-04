"""Export the Logs contract and optionally a full spec for client generation.

Run with the backend environment loaded:
    python -m scripts.dump_logs_openapi --full-output /tmp/dograh.openapi.json
"""

import argparse
import json
from pathlib import Path

from fastapi.openapi.utils import get_openapi

from api.app import app

REPO = Path(__file__).resolve().parents[1]


def references(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref" and isinstance(item, str):
                yield item.rsplit("/", 1)[-1]
            else:
                yield from references(item)
    elif isinstance(value, list):
        for item in value:
            yield from references(item)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full-output", type=Path)
    args = parser.parse_args()
    full = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        servers=app.servers,
    )
    paths = {
        key: value
        for key, value in full["paths"].items()
        if key.startswith("/api/v1/logs/")
    }
    schemas = {}
    pending = set(references(paths))
    while pending:
        key = pending.pop()
        if key not in schemas:
            schemas[key] = full["components"]["schemas"][key]
            pending.update(set(references(schemas[key])) - schemas.keys())
    spec = {
        "openapi": full["openapi"],
        "info": {"title": "Dograh Logs API", "version": "1.0.0"},
        "paths": paths,
        "components": {"schemas": dict(sorted(schemas.items()))},
    }
    output = REPO / "api" / "logs.openapi.json"
    output.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    if args.full_output:
        args.full_output.write_text(json.dumps(full), encoding="utf-8")
    print(f"Wrote {len(paths)} Logs paths to {output}")


if __name__ == "__main__":
    main()
