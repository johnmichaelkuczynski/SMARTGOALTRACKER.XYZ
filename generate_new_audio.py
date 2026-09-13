import os
import json
import urllib.request
from urllib.error import HTTPError

api_key = os.environ.get("ELEVENLABS_API_KEY")
voice_id = "cjVigY5qzO86Huf0OWal" # Eric (Relaxed, Authoritative American male baritone)
url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

text = "Meet the Interactive Living Diary. It turns your daily reflection into an ongoing conversation. There's no separate AI chat—you write directly in the unified diary box, and your informed response appears right there. It securely draws on your goals, tasks, history, and documents to provide a personalized, concise response, always kept to one paragraph. It's enabled by default, but you can switch it off anytime for conventional writing. You can even start multiple entries on the same date, each keeping its own unique conversation history. It's your diary, reimagined."

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
        with open("living_diary_voiceover.mp3", "wb") as f:
            f.write(response.read())
    print("Voiceover generated as living_diary_voiceover.mp3")
except HTTPError as e:
    print(e.read().decode())
