import os
import json
import urllib.request
import time
from urllib.error import HTTPError

api_key = os.environ.get("ELEVENLABS_API_KEY")
voice_id = "cjVigY5qzO86Huf0OWal" # Eric

texts = [
    "Want a diary that talks back?",
    "Want a diary that knows you?",
    "Well, now you have one.",
    "Smart Goal Tracker isn’t just a calendar. It works with you.",
    "It knows about you and constantly updates its understanding of who you are and what you are trying to do.",
    "It remembers what you have said, knows how you have grown, and knows how you can optimize yourself.",
    "Take the Interactive Diary. You write in your diary—and it writes back.",
    "And it’s smart because it knows you.",
    "Smart Goal Tracker.",
    "How can we make your life easier?"
]

url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

for i, text in enumerate(texts):
    print(f"Generating block {i}...")
    data = json.dumps({
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }).encode('utf-8')

    req = urllib.request.Request(url, data=data, headers={
        "xi-api-key": api_key,
        "Content-Type": "application/json"
    })

    try:
        with urllib.request.urlopen(req) as response:
            with open(f"audio_block_{i}.mp3", "wb") as f:
                f.write(response.read())
    except HTTPError as e:
        print(f"Failed block {i}:", e.read().decode())
        
    time.sleep(0.5)
