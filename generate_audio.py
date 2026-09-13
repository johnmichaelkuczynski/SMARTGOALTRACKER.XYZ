import os
import json
import urllib.request
from urllib.error import HTTPError

api_key = os.environ.get("ELEVENLABS_API_KEY")
voice_id = "cjVigY5qzO86Huf0OWal" # Eric
url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

text = "You know that feeling when your goals are scattered across notes, calendars, and half-finished lists? This brings everything together in one calm workspace. Plan your day. Break big goals into clear next steps. Check off progress, and keep notes, journal entries, and your diary close by. Search across everything instantly. And when you want a bigger-picture view, the Mind section uses your real activity to help you spot patterns and move forward. Less mental clutter. More steady progress. Your goals, finally working with you."

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
        with open("voiceover.mp3", "wb") as f:
            f.write(response.read())
    print("Voiceover generated as voiceover.mp3")
except HTTPError as e:
    print(e.read().decode())
