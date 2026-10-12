#!/usr/bin/env python3
"""Rasterize 100 authored original SVG quiz cards to Facebook-ready 1080px PNG."""
from pathlib import Path
import cairosvg

CARDS = Path("pop-culture/cards")
images = sorted(CARDS.glob("*.svg"))
if len(images) != 100:
    raise SystemExit(f"Expected 100 SVG designs, found {len(images)}")
for source in images:
    dest = source.with_suffix(".png")
    if dest.exists() and source.stem not in {f'quiz-{n:03d}' for n in range(1, 11)}:
        continue
    cairosvg.svg2png(url=str(source), write_to=str(dest), output_width=1080, output_height=1080)
    if dest.stat().st_size < 4000:
        raise RuntimeError(f"Generated PNG suspiciously small: {dest}")
print(f"Verified {len(images)} designed PNG posts")
