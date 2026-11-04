#!/usr/bin/env python3
"""Validate the shipped, self-contained original SNIPE assets (stdlib only)."""
import hashlib
import json
import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
REQUIRED = {"root", "muzzle", "scope_mount", "ejection_port", "grip_r", "grip_l", "bolt", "magazine", "hands", "hand_l", "hand_r", "optic_root", "eye_point"}
RIFLES = {"ranger", "sentinel", "kestrel", "atlas"}


def validate_glb(path):
    raw = path.read_bytes()
    magic, version, size = struct.unpack_from("<4sII", raw)
    assert magic == b"glTF" and version == 2 and size == len(raw), path
    json_length, json_type = struct.unpack_from("<I4s", raw, 12)
    assert json_type == b"JSON" and json_length % 4 == 0
    doc = json.loads(raw[20:20 + json_length])
    binary_at = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<I4s", raw, binary_at)
    binary = raw[binary_at + 8:]
    assert binary_type == b"BIN\0" and binary_length == len(binary)
    assert doc["asset"]["version"] == "2.0"
    assert len(doc["buffers"]) == 1 and "uri" not in doc["buffers"][0], "must be self-contained"
    assert doc["buffers"][0]["byteLength"] <= len(binary)
    assert "images" not in doc, "this asset family uses original PBR colors, no external textures"
    for view in doc["bufferViews"]:
        assert view["buffer"] == 0
        assert view.get("byteOffset", 0) % 4 == 0
        assert view.get("byteOffset", 0) + view["byteLength"] <= doc["buffers"][0]["byteLength"]

    def values(index):
        a = doc["accessors"][index]
        v = doc["bufferViews"][a["bufferView"]]
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        fmt, bytes_per = {5126: ("f", 4), 5123: ("H", 2)}[a["componentType"]]
        count = a["count"] * width
        assert count * bytes_per <= v["byteLength"]
        data = struct.unpack_from("<" + fmt * count, binary, v.get("byteOffset", 0))
        assert all(math.isfinite(x) for x in data)
        return a, data

    for mesh in doc["meshes"]:
        for p in mesh["primitives"]:
            positions, pos = values(p["attributes"]["POSITION"])
            normals, n = values(p["attributes"]["NORMAL"])
            indices, ix = values(p["indices"])
            assert positions["count"] == normals["count"]
            assert len(ix) % 3 == 0 and max(ix) < positions["count"]
            for i in range(0, len(n), 3):
                assert .97 <= sum(v * v for v in n[i:i+3]) <= 1.03, "normals must be unit length"
            assert 0 <= p["material"] < len(doc["materials"])
    parents = {}
    for i, node in enumerate(doc["nodes"]):
        for child in node.get("children", []):
            assert child not in parents and 0 <= child < len(doc["nodes"])
            parents[child] = i
        if "mesh" in node:
            assert 0 <= node["mesh"] < len(doc["meshes"])
    names = {node["name"] for node in doc["nodes"]}
    if path.stem in RIFLES:
        assert REQUIRED <= names, f"missing anchors: {REQUIRED - names}"
        muzzle = next(n for n in doc["nodes"] if n["name"] == "muzzle")
        assert muzzle["translation"][2] > .4
        assert sum("mesh" in n for n in doc["nodes"]) <= 30, "static parts should be batched"
    if path.stem.startswith("target_"):
        assert {"target_root", "hit_surface", "reaction_pivot"} <= names
        surface = next(n for n in doc["nodes"] if n["name"] == "hit_surface")
        assert abs(surface.get("translation", [0,0,0])[0]) < 1e-8
        assert abs(surface.get("translation", [0,0,0])[1]) < 1e-8
    return len(doc["nodes"]), sum("mesh" in n for n in doc["nodes"])


def main():
    manifest = json.loads((ASSETS / "manifest.json").read_text())
    assert manifest["version"] == 1
    ids = set()
    total = 0
    count = 0
    for entry in manifest["assets"]:
        assert entry["id"] not in ids
        ids.add(entry["id"])
        path = ASSETS / entry["path"]
        assert path.is_file() and path.is_relative_to(ASSETS)
        raw = path.read_bytes()
        assert len(raw) == entry["sizeBytes"]
        assert hashlib.sha256(raw).hexdigest() == entry["sha256"]
        assert entry["license"] == "CC0-1.0" and entry["source"] == "Original procedural asset"
        total += len(raw)
        if path.suffix == ".glb":
            nodes, draws = validate_glb(path)
            print(f"OK {entry['path']}: {nodes} nodes, {draws} mesh nodes")
        else:
            with wave.open(str(path)) as wav:
                assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
                assert wav.getframerate() == 22050 and wav.getnframes() > 100
                samples = struct.unpack("<" + "h" * wav.getnframes(), wav.readframes(wav.getnframes()))
                assert any(abs(v) > 1000 for v in samples), "non-silent audio"
                assert max(abs(v) for v in samples) < 32767, "no PCM clipping"
                if entry["id"] == "ambient":
                    assert wav.getnframes() == 16 * 22050
                    assert abs(samples[0] - samples[-1]) <= 2, "loop endpoint discontinuity"
            print(f"OK {entry['path']}")
        count += 1
    expected = RIFLES | {"scope_field","scope_precision","scope_survey","target_paper","target_gong","target_plate","target_reactive","wind_flag","ambient","bolt","reload","impact_metal","impact_paper","impact_dirt","click","success"} | {"shot_" + r for r in RIFLES}
    assert ids == expected
    assert total < 15 * 1024 * 1024
    print(f"PASS: {count} assets; {total:,} bytes; geometry, anchors, hashes and audio verified")


if __name__ == "__main__":
    main()
