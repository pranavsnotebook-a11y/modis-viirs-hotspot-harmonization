#!/usr/bin/env python3
"""One narration line -> mp3 plus word timings, with the edge-tts neural voice (needs network; `pip install edge-tts`).
usage: tts.py <text_file> <out.mp3> <out.json> [voice] [rate]
json: {"words": [{"w": "Suppose", "start": 0.1, "end": 0.5}, ...]} (seconds)"""
import asyncio
import json
import sys

import edge_tts


async def main(text_file, mp3, out_json, voice="en-US-AndrewNeural", rate="+0%"):
    text = open(text_file, encoding="utf-8").read().strip()
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words = []
    with open(mp3, "wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                s = chunk["offset"] / 1e7
                words.append({"w": chunk["text"], "start": round(s, 3), "end": round(s + chunk["duration"] / 1e7, 3)})
    with open(out_json, "w") as f:
        json.dump({"words": words}, f)


asyncio.run(main(*sys.argv[1:]))
