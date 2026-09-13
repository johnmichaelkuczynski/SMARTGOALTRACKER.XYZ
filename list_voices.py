import os
import requests
import json

api_key = os.environ.get("ELEVENLABS_API_KEY")
url = "https://api.elevenlabs.io/v1/voices"
headers = {"xi-api-key": api_key}
response = requests.get(url, headers=headers)
voices = response.json().get("voices", [])

for v in voices:
    labels = v.get("labels", {})
    description = v.get("description", "")
    print(f"{v['name']} ({v['voice_id']}): {labels} - {description}")
